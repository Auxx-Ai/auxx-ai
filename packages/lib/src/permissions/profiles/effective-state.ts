// packages/lib/src/permissions/profiles/effective-state.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { MemberType, type ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType, UserType } from '@auxx/database/types'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getCachedResources } from '../../cache'
import type { Resource } from '../../resources/registry/types'
import { isCustomResourceId } from '../../resources/registry/types'
import { composeUserCapabilities } from '../capabilities/compose-user-capabilities'
import {
  effectiveInstanceLevel,
  effectiveRecordLevel,
  type ResolvedRecordAccess,
} from '../capabilities/entity-access'
import {
  INSTANCE_ACCESS_KEYS,
  type InstanceAccessKey,
  isInstanceAccessKey,
} from '../capabilities/instance-access'
import {
  AREA_ORDER,
  type Area,
  areaLevelFromKeys,
  type Level,
  parseAreaLevels,
} from '../capabilities/registry'
import { resolveCapabilityInputs } from '../capabilities/resolve-capability-inputs'
import { projectPermissionProfile } from './profile-projection'
import { resolveBaseProfile } from './profile-resolution'
import type { CachedPermissionProfile } from './types'

/** A `Database` or an open transaction — both satisfy the query builder. */
export type QueryRunner = Database | Transaction

/**
 * One principal's **resulting effective state** (doc 19 §6.1.2): the three
 * domains the escalation guard compares. Absent keys mean "no access" — rank 0 —
 * so `before`/`after` maps of different shapes compare correctly.
 */
export interface EffectiveState {
  userId: string
  /** Per-area rung, materialized for every area (never sparse). */
  areas: Record<Area, Level>
  /** `effectiveRecordLevel` per canonical `entityDefinitionId`; absent = no access. */
  defs: Record<string, ResourcePermission>
  /** `effectiveInstanceLevel` per instance CUID; absent = no access. */
  instances: Record<string, ResourcePermission>
}

/** One raw grant row (sparse jsonb levels) keyed by its grantee. */
interface GrantRow {
  granteeType: string
  granteeId: string
  levels: unknown
}

/** One raw ResourceAccess row, type-level or instance-level. */
interface AccessRow {
  granteeType: string
  granteeId: string
  entityDefinitionId: string
  entityInstanceId: string | null
  permission: ResourcePermission
}

interface MemberRow {
  userId: string
  role: OrganizationRole
  seatType: SeatType
  permissionProfileId: string | null
  userType: UserType
}

/**
 * Everything the composer needs for a whole batch of holders, read ONCE from the
 * transaction. Holders of one profile differ only in role, seatType, group
 * memberships and personal grants (§6.1.4), so this is O(1) queries for O(N)
 * principals.
 */
interface UncachedInputs {
  members: Map<string, MemberRow>
  profiles: CachedPermissionProfile[]
  groupIdsByUser: Map<string, string[]>
  grants: GrantRow[]
  typeRows: AccessRow[]
  instanceRows: AccessRow[]
  resources: Resource[]
  /** Org-wide defs carrying ≥1 type-level row for ANYONE (grantee-agnostic, §0). */
  restrictedEntityDefIds: Set<string>
  /** Instance CUID → its instance-access resource key (`dataset` | `kb` | …). */
  instanceKeyById: Map<string, InstanceAccessKey>
}

/**
 * Read every composition input for `userIds` directly from `tx`, **bypassing the
 * org cache**.
 *
 * This is the load-bearing half of §6.1.4. `computeUserCapabilities` resolves the
 * profile projection, the member role map and the group memberships out of
 * `getOrgCache()`, which inside an open transaction still returns **pre-write**
 * values — so composing the post-write state through it would compare
 * before-state to before-state and the escalation guard would always pass. Every
 * mutable input below is therefore read from the transaction.
 *
 * `resources` is the one exception and deliberately so: it is the org's entity
 * *definition* projection (slug ↔ `entityDefinitionId`), which a profile save
 * cannot change. It is a lookup table, not state under comparison.
 */
async function readUncachedInputs(
  organizationId: string,
  userIds: string[],
  tx: QueryRunner
): Promise<UncachedInputs> {
  const [memberRows, profileRows, groupRows, resources] = await Promise.all([
    tx
      .select({
        userId: schema.OrganizationMember.userId,
        role: schema.OrganizationMember.role,
        seatType: schema.OrganizationMember.seatType,
        permissionProfileId: schema.OrganizationMember.permissionProfileId,
        userType: schema.User.userType,
      })
      .from(schema.OrganizationMember)
      .leftJoin(schema.User, eq(schema.User.id, schema.OrganizationMember.userId))
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          inArray(schema.OrganizationMember.userId, userIds)
        )
      ),
    tx
      .select({
        id: schema.PermissionProfile.id,
        slug: schema.PermissionProfile.slug,
        name: schema.PermissionProfile.name,
        description: schema.PermissionProfile.description,
        icon: schema.PermissionProfile.icon,
        seat: schema.PermissionProfile.seat,
        appliesTo: schema.PermissionProfile.appliesTo,
        role: schema.PermissionProfile.role,
        baseLevel: schema.PermissionProfile.baseLevel,
        ceiling: schema.PermissionProfile.ceiling,
        agentPolicy: schema.PermissionProfile.agentPolicy,
        isSystem: schema.PermissionProfile.isSystem,
        updatedAt: schema.PermissionProfile.updatedAt,
      })
      .from(schema.PermissionProfile)
      .where(eq(schema.PermissionProfile.organizationId, organizationId)),
    tx
      .select({
        userId: schema.EntityGroupMember.memberRefId,
        groupId: schema.EntityGroupMember.groupInstanceId,
      })
      .from(schema.EntityGroupMember)
      .innerJoin(
        schema.EntityInstance,
        eq(schema.EntityGroupMember.groupInstanceId, schema.EntityInstance.id)
      )
      .where(
        and(
          eq(schema.EntityGroupMember.memberType, MemberType.user),
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityGroupMember.memberRefId, userIds)
        )
      ),
    getCachedResources(organizationId),
  ])

  const groupIdsByUser = new Map<string, string[]>()
  for (const row of groupRows) {
    const list = groupIdsByUser.get(row.userId)
    if (list) list.push(row.groupId)
    else groupIdsByUser.set(row.userId, [row.groupId])
  }

  const [grants, typeRows, instanceRows] = await Promise.all([
    // Every grant row in the org: one sparse-jsonb row per grantee (profile /
    // group / user), so this is small and a single fetch beats a per-holder IN.
    tx
      .select({
        granteeType: schema.PermissionGrant.granteeType,
        granteeId: schema.PermissionGrant.granteeId,
        levels: schema.PermissionGrant.levels,
      })
      .from(schema.PermissionGrant)
      .where(eq(schema.PermissionGrant.organizationId, organizationId)),
    // Type-level rows for the WHOLE org, not just these grantees: the
    // `restrictedEntityDefIds` signal is grantee-agnostic by design (a row for
    // anyone flips the def to restricted for everyone), so a grantee-filtered
    // read would silently mis-resolve every holder's def level.
    tx
      .select({
        granteeType: schema.ResourceAccess.granteeType,
        granteeId: schema.ResourceAccess.granteeId,
        entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
        entityInstanceId: schema.ResourceAccess.entityInstanceId,
        permission: schema.ResourceAccess.permission,
      })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          isNull(schema.ResourceAccess.entityInstanceId)
        )
      ),
    // Instance-level rows for the instance-access resources only. Unlike defs,
    // an instance the holders hold no row for is never in the comparison set, so
    // the grantee-agnostic restricted set is not needed here.
    tx
      .select({
        granteeType: schema.ResourceAccess.granteeType,
        granteeId: schema.ResourceAccess.granteeId,
        entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
        entityInstanceId: schema.ResourceAccess.entityInstanceId,
        permission: schema.ResourceAccess.permission,
      })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          inArray(schema.ResourceAccess.entityDefinitionId, INSTANCE_ACCESS_KEYS),
          isNotNull(schema.ResourceAccess.entityInstanceId)
        )
      ),
  ])

  const restrictedEntityDefIds = new Set<string>()
  for (const row of typeRows as AccessRow[]) {
    if (isCustomResourceId(row.entityDefinitionId))
      restrictedEntityDefIds.add(row.entityDefinitionId)
  }

  const instanceKeyById = new Map<string, InstanceAccessKey>()
  for (const row of instanceRows as AccessRow[]) {
    if (row.entityInstanceId && isInstanceAccessKey(row.entityDefinitionId)) {
      instanceKeyById.set(row.entityInstanceId, row.entityDefinitionId)
    }
  }

  return {
    members: new Map((memberRows as MemberRow[]).map((row) => [row.userId, row])),
    profiles: profileRows.map(projectPermissionProfile),
    groupIdsByUser,
    grants: grants as GrantRow[],
    typeRows: typeRows as AccessRow[],
    instanceRows: instanceRows as AccessRow[],
    resources,
    restrictedEntityDefIds,
    instanceKeyById,
  }
}

/**
 * Whether a ResourceAccess / PermissionGrant row belongs to this principal's
 * grantee union — the same union `computeUserCapabilities` builds its `WHERE`
 * from (direct user, the legacy `role:org_member` baseline marker, the bound
 * profile, the principal's groups).
 *
 * `role:org_member` is deliberately shared by both tables here even though the
 * composer's PermissionGrant union dropped it (§0.8): {@link composeState}
 * dispatches grant rows by grantee kind and has **no `role` branch**, so a
 * surviving legacy grant row is matched and then ignored — identical to the
 * composer skipping it in SQL. Do not add a `role` branch there.
 */
function matchesGrantee(
  row: { granteeType: string; granteeId: string },
  userId: string,
  profileId: string | null,
  groupIds: string[]
): boolean {
  if (row.granteeType === 'user') return row.granteeId === userId
  if (row.granteeType === 'role') return row.granteeId === 'org_member'
  if (row.granteeType === 'profile') return profileId !== null && row.granteeId === profileId
  if (row.granteeType === 'group') return groupIds.includes(row.granteeId)
  return false
}

/**
 * Compose one principal's {@link EffectiveState} from an already-read batch.
 *
 * Runs the PURE {@link composeUserCapabilities} — the identical function the
 * cached read path composes with — then measures the three domains through the
 * identical enforcement predicates (`areaLevelFromKeys`, `effectiveRecordLevel`,
 * `effectiveInstanceLevel`). Nothing here re-derives a permission rule.
 */
function composeState(
  userId: string,
  inputs: UncachedInputs,
  organizationId: string
): EffectiveState {
  const member = inputs.members.get(userId)
  const role = member?.role
  const seatType = member?.seatType ?? 'full'
  const userType = member?.userType ?? 'USER'
  const groupIds = inputs.groupIdsByUser.get(userId) ?? []

  const baseProfile = role
    ? resolveBaseProfile({
        organizationId,
        userId,
        role,
        seatType,
        permissionProfileId: member?.permissionProfileId ?? null,
        profiles: inputs.profiles,
      })
    : null
  const profileId = baseProfile?.profileId ?? null

  // Mirror `computeUserCapabilities`' short-circuit EXACTLY: it skips the
  // PermissionGrant query for OWNER only (doc 19 §5.3 piece 2 — ADMIN now loads
  // grant rows so the `admin` profile is not inert), so an owner's composed
  // state ignores grant rows. Reading them here would make the guard measure a
  // state enforcement never produces — and, for ADMIN, *not* reading them would
  // hide exactly the escalation the guard exists to catch.
  const isOwner = role === 'OWNER'
  let profileLevels: Partial<Record<Area, Level>> | undefined
  const groupLevels: Array<Partial<Record<Area, Level>>> = []
  let userLevels: Partial<Record<Area, Level>> | undefined
  if (!isOwner) {
    for (const row of inputs.grants) {
      if (!matchesGrantee(row, userId, profileId, groupIds)) continue
      const levels = parseAreaLevels(row.levels)
      if (row.granteeType === 'profile') profileLevels = levels
      else if (row.granteeType === 'group') groupLevels.push(levels)
      else if (row.granteeType === 'user') userLevels = levels
    }
  }

  const typeAccessRows = inputs.typeRows
    .filter((row) => matchesGrantee(row, userId, profileId, groupIds))
    .map((row) => ({ entityDefinitionId: row.entityDefinitionId, permission: row.permission }))
  const instanceAccessRows = inputs.instanceRows
    .filter((row) => matchesGrantee(row, userId, profileId, groupIds))
    .map((row) => ({ entityInstanceId: row.entityInstanceId ?? '', permission: row.permission }))

  const caps = composeUserCapabilities({
    role,
    seatType,
    userType,
    profileLevels,
    profileBaseLevel: baseProfile?.baseLevel ?? null,
    profileCeiling: baseProfile?.ceiling ?? null,
    groupLevels,
    userLevels,
    typeAccessRows,
    instanceAccessRows,
  })

  const resolved = resolveCapabilityInputs(caps, inputs.resources)
  const access: ResolvedRecordAccess = {
    role: role ?? 'USER',
    seatType,
    keys: resolved.keys,
    defAccess: resolved.defAccess,
    restrictedEntityDefIds: inputs.restrictedEntityDefIds,
    defBaseOverrides: resolved.defBaseOverrides,
    instanceAccess: caps.instanceAccess,
    // The instance query is deliberately grantee-agnostic, so its id set IS the
    // org-wide `restrictedInstanceIds` projection, recomputed from the txn.
    restrictedInstanceIds: new Set(inputs.instanceKeyById.keys()),
  }

  const areas = {} as Record<Area, Level>
  for (const area of AREA_ORDER) areas[area] = areaLevelFromKeys(resolved.keys, area)

  const defs: Record<string, ResourcePermission> = {}
  for (const resource of inputs.resources) {
    const level = effectiveRecordLevel(access, resource.entityDefinitionId)
    if (level !== undefined) defs[resource.entityDefinitionId] = level
  }

  const instances: Record<string, ResourcePermission> = {}
  for (const [instanceId, key] of inputs.instanceKeyById) {
    const level = effectiveInstanceLevel(access, key, instanceId)
    if (level !== undefined) instances[instanceId] = level
  }

  // A non-member holds nothing — `composeUserCapabilities` already fails closed,
  // and the loops above then yield empty maps.
  return { userId, areas, defs, instances }
}

/**
 * Compose the {@link EffectiveState} of many principals from ONE batch of
 * transaction-local reads — the §6.1.4 "batch, do not loop" requirement.
 *
 * Six queries regardless of holder count; the per-holder work is pure in-memory
 * composition through {@link composeUserCapabilities}.
 */
export async function computeEffectiveStatesUncached(input: {
  organizationId: string
  userIds: string[]
  tx: QueryRunner
}): Promise<Map<string, EffectiveState>> {
  const { organizationId, tx } = input
  const userIds = [...new Set(input.userIds)]
  const out = new Map<string, EffectiveState>()
  if (userIds.length === 0) return out

  const inputs = await readUncachedInputs(organizationId, userIds, tx)
  for (const userId of userIds) out.set(userId, composeState(userId, inputs, organizationId))
  return out
}

/**
 * Single-principal convenience over {@link computeEffectiveStatesUncached} — the
 * `computeEffectiveStateUncached(userId, orgId, tx)` of §6.1.4. Prefer the batch
 * form whenever more than one principal is involved.
 */
export async function computeEffectiveStateUncached(
  userId: string,
  organizationId: string,
  tx: QueryRunner
): Promise<EffectiveState> {
  const states = await computeEffectiveStatesUncached({ organizationId, userIds: [userId], tx })
  const state = states.get(userId)
  if (state) return state
  // Unreachable: the batch always emits an entry per requested id.
  throw new Error(`Effective state was not composed for user ${userId}`)
}
