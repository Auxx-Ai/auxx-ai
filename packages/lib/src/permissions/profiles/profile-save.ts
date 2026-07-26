// packages/lib/src/permissions/profiles/profile-save.ts

import { type Database, database, type PermissionProfileEntity, schema } from '@auxx/database'
import type { OrganizationRole } from '@auxx/database/types'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors'
import { assertGrantableLevels } from '../capabilities/grant-service'
import { type Area, type Level, parseAreaLevels } from '../capabilities/registry'
import { FeaturePermissionService } from '../feature-permission-service'
import { FeatureKey } from '../types'
import { computeEffectiveStatesUncached, type QueryRunner } from './effective-state'
import {
  type ActorAuthority,
  assertNoEscalation,
  assertProfileMapNoEscalation,
  HOLDER_GUARD_CAP,
} from './escalation-guard'
import {
  emitPermissionProfileChanged,
  fanOutCapabilityChange,
  resolveProfileAudience,
  resolveProfileHolderIds,
} from './profile-invalidation'
import { parseProfileCeiling } from './profile-projection'
import type { AgentPermissionPolicy } from './types'

/**
 * The ONE transactional profile save (§6.1.4). The editor submits metadata,
 * area levels and (once step 9 lands) the per-def / per-instance rows as a
 * **single** mutation — the multi-request variant is deliberately not offered,
 * because a save spanning three requests cannot enforce one atomic "resulting
 * effective state" check.
 *
 * There is deliberately no `ceiling` field: the profile ceiling lost its
 * authoring surface in plan 20 §2.a.1 and is now unauthored code (see
 * `ProfileCeiling` in `types.ts`).
 */
export interface SavePermissionProfileInput {
  organizationId: string
  /** Who is saving — their own effective state is the authority ceiling (§6.1.1). */
  actorUserId: string
  profileId: string
  name?: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  /** The profile's blanket rung for areas `levels` does not set. */
  baseLevel?: Level | null
  /** Agent-profile exact policy. OWNER/ADMIN only (§0.25 / doc 14 §0.9). */
  agentPolicy?: AgentPermissionPolicy | null
  /**
   * The profile's per-area BASE, stored as its one `PermissionGrant` row.
   * `null` clears the row (every area falls through to `baseLevel` /
   * `ROLE_DEFAULTS`); omitted leaves it untouched.
   */
  levels?: Partial<Record<Area, Level>> | null
  /**
   * Per-def `ResourceAccess` rows on the profile grantee (§1.2). Accepted so the
   * mutation's shape is the §6.1.4 one, but any non-empty value is refused until
   * step 9 teaches the remaining resolvers the `profile` grantee — see
   * `resource-access-service.ts`'s `assertProfileGranteeSupported`.
   */
  defAccess?: unknown[]
  /** Per-instance `ResourceAccess` rows on the profile grantee — see {@link defAccess}. */
  instanceAccess?: unknown[]
  db?: Database
}

/** The profile row fields the save reads before writing. */
interface ProfileRow {
  id: string
  slug: string
  isSystem: boolean
  appliesTo: string
  baseLevel: number | null
  ceiling: unknown
}

/**
 * Save a permission profile inside ONE transaction, with the §6.1 escalation
 * guard evaluated on **post-write** state.
 *
 * Order is exactly §6.1.4's:
 *
 * ```
 * db.transaction(async (tx) => {
 *   const before = snapshotEffectiveStates(holders, tx)  // pre-write, inside the txn
 *   applyMetadata(tx); upsertPermissionGrant(tx)
 *   const after  = snapshotEffectiveStates(holders, tx)  // re-read post-write
 *   assertNoEscalation(actor, before, after)             // ForbiddenError → rollback
 * })
 * // AFTER commit only: permission-profile.changed + invalidation (§8.3)
 * ```
 *
 * The snapshots come from {@link computeEffectiveStatesUncached}, which reads
 * every mutable input from `tx`. Composing `after` through `getOrgCache()` would
 * return pre-write values and the guard would silently always pass.
 *
 * Gates that run in addition to the guard (§6.1.5 — each is its own line of
 * defense, none replaces another): the `granularPermissions` plan gate on every
 * write (§0.26 — seeding is exempt because `ensureSystemProfiles` never comes
 * through here), cross-org ownership, the `owner`-profile immutability, the
 * OWNER/ADMIN-only rule for agent profiles, and `assertGrantableLevels`.
 */
export async function savePermissionProfile(
  input: SavePermissionProfileInput
): Promise<PermissionProfileEntity> {
  const { organizationId, actorUserId, profileId } = input
  const db = input.db ?? database

  if ((input.defAccess?.length ?? 0) > 0 || (input.instanceAccess?.length ?? 0) > 0) {
    throw new BadRequestError(
      'Profile-scoped resource grants are not enabled yet — see plans/permissions/v2/19-permission-profiles.md step 9.'
    )
  }

  const saved = await db.transaction(async (tx) => {
    const profile = await loadProfile(tx, organizationId, profileId)
    const actorRole = await loadActorRole(tx, organizationId, actorUserId)

    if (profile.slug === 'owner') {
      throw new ForbiddenError('The Owner profile is not editable — it is the recovery guarantee.')
    }
    // §0.25: making the `permissions` area grantable must NOT hand agent policy
    // to a non-admin. Agent-side profile editing stays OWNER/ADMIN-only.
    if (
      (profile.appliesTo === 'agent' || input.agentPolicy !== undefined) &&
      actorRole !== 'OWNER' &&
      actorRole !== 'ADMIN'
    ) {
      throw new ForbiddenError(
        'Only owners and admins can edit an agent permission profile (doc 14 §0.9).'
      )
    }

    // §0.26 — writes are plan-gated; composition never is.
    await new FeaturePermissionService(tx).requireAccess(
      organizationId,
      FeatureKey.granularPermissions
    )

    // §6.1.3 — one sweep, shared with §8.3 invalidation, including the null-bound
    // majority. Bindings are not touched by this mutation, so the cached role map
    // it reads is not part of the before/after comparison.
    //
    // §6.1.3's table also lists `OrganizationInvitation` rows bound to the
    // profile. They are deliberately absent: an invitee has no `User`, so there is
    // no effective state to compose either side of. The authority check for them
    // runs at acceptance, where a member row (and a composable state) exists.
    const holderIds = await resolveProfileHolderIds({
      organizationId,
      profileId,
      slug: profile.slug,
      isSystem: profile.isSystem,
    })
    const exact = holderIds !== null && holderIds.length <= HOLDER_GUARD_CAP

    // The actor's authority is their PRE-write state: a save must never be able
    // to authorize itself by first raising the actor's own access (§6.1.1).
    const beforeIds = exact ? [...(holderIds ?? []), actorUserId] : [actorUserId]
    const before = await computeEffectiveStatesUncached({
      organizationId,
      userIds: beforeIds,
      tx,
    })
    const actorState = before.get(actorUserId)
    if (!actorState) throw new ForbiddenError('You are not a member of this organization.')
    const actor: ActorAuthority = { userId: actorUserId, role: actorRole, state: actorState }

    // The strict fallback compares the profile's own maps, so its "before" has
    // to be read here — before the writes land, exactly like the state snapshot.
    const beforeLevels = exact ? {} : await readProfileLevels(tx, organizationId, profileId)

    const wroteLevels = await applyWrites(tx, organizationId, profile, input)

    if (exact) {
      const after = await computeEffectiveStatesUncached({
        organizationId,
        userIds: holderIds ?? [],
        tx,
      })
      assertNoEscalation({ actor, before, after })
    } else {
      // >500 holders (or an unclassifiable profile): composing every holder's
      // state stops being affordable, so fall back to the strict profile-map
      // check (§6.1.3), which is deliberately more conservative (§11.6).
      const afterLevels =
        input.levels === undefined
          ? beforeLevels
          : input.levels === null
            ? {}
            : parseAreaLevels(input.levels)
      // The ceiling is unauthored, so it is identical on both sides — carried
      // only because `ProfileAuthoredState` is what composition reads.
      const ceiling = parseProfileCeiling(profile.ceiling)
      assertProfileMapNoEscalation({
        actor,
        before: {
          levels: beforeLevels,
          baseLevel: (profile.baseLevel as Level | null) ?? null,
          ceiling,
        },
        after: {
          levels: afterLevels,
          baseLevel: (input.baseLevel ?? profile.baseLevel ?? null) as Level | null,
          ceiling,
        },
      })
    }

    const [row] = await tx
      .select()
      .from(schema.PermissionProfile)
      .where(eq(schema.PermissionProfile.id, profileId))
      .limit(1)

    return { row: row as PermissionProfileEntity, profile, wroteLevels }
  })

  // AFTER commit only (§8.3). Two events because they bust different org keys:
  // `permission-profile.changed` → the `profiles` projection, and
  // `permission-grant.changed` → `hasPermissionGrants`, the flag that decides
  // whether the composer reads grant rows at all.
  const audience = await resolveProfileAudience({
    organizationId,
    profileId,
    slug: saved.profile.slug,
    isSystem: saved.profile.isSystem,
  })
  await emitPermissionProfileChanged({
    organizationId,
    profileId,
    slug: saved.profile.slug,
    isSystem: saved.profile.isSystem,
    audience,
  })
  if (saved.wroteLevels) {
    await fanOutCapabilityChange('permission-grant.changed', organizationId, audience)
  }

  return saved.row
}

/** Load the target profile, refusing a cross-org id outright (§1.1). */
async function loadProfile(
  tx: QueryRunner,
  organizationId: string,
  profileId: string
): Promise<ProfileRow> {
  const [row] = await tx
    .select({
      id: schema.PermissionProfile.id,
      slug: schema.PermissionProfile.slug,
      isSystem: schema.PermissionProfile.isSystem,
      appliesTo: schema.PermissionProfile.appliesTo,
      baseLevel: schema.PermissionProfile.baseLevel,
      ceiling: schema.PermissionProfile.ceiling,
    })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.id, profileId),
        eq(schema.PermissionProfile.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!row) throw new NotFoundError('Permission profile not found in this organization.')
  return row as ProfileRow
}

/** The actor's org role — the §6.1.1 OWNER short-circuit and the agent gate. */
async function loadActorRole(
  tx: QueryRunner,
  organizationId: string,
  actorUserId: string
): Promise<OrganizationRole> {
  const [row] = await tx
    .select({ role: schema.OrganizationMember.role })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.userId, actorUserId)
      )
    )
    .limit(1)

  if (!row) throw new ForbiddenError('You are not a member of this organization.')
  return row.role
}

/** Read the profile's currently stored area levels (for the strict fallback). */
async function readProfileLevels(
  tx: QueryRunner,
  organizationId: string,
  profileId: string
): Promise<Partial<Record<Area, Level>>> {
  const [row] = await tx
    .select({ levels: schema.PermissionGrant.levels })
    .from(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, 'profile'),
        eq(schema.PermissionGrant.granteeId, profileId)
      )
    )
    .limit(1)

  return row ? parseAreaLevels(row.levels) : {}
}

/**
 * Apply every write of the save inside the transaction. Returns whether the
 * profile's `PermissionGrant` row was touched (which decides whether the
 * post-commit fan-out also needs the grant event).
 */
async function applyWrites(
  tx: QueryRunner,
  organizationId: string,
  profile: ProfileRow,
  input: SavePermissionProfileInput
): Promise<boolean> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.description !== undefined) patch.description = input.description
  if (input.icon !== undefined) patch.icon = input.icon
  if (input.baseLevel !== undefined) patch.baseLevel = input.baseLevel
  if (input.agentPolicy !== undefined) patch.agentPolicy = input.agentPolicy

  if (Object.keys(patch).length > 0) {
    await tx
      .update(schema.PermissionProfile)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(schema.PermissionProfile.id, profile.id),
          eq(schema.PermissionProfile.organizationId, organizationId)
        )
      )
  }

  if (input.levels === undefined) return false

  if (input.levels === null || Object.keys(input.levels).length === 0) {
    await tx
      .delete(schema.PermissionGrant)
      .where(
        and(
          eq(schema.PermissionGrant.organizationId, organizationId),
          eq(schema.PermissionGrant.granteeType, 'profile'),
          eq(schema.PermissionGrant.granteeId, profile.id)
        )
      )
    return true
  }

  // `Level.None` is KEPT for a profile grantee — it is the composition base, so a
  // stored None genuinely zeroes the area (stripping it would fail OPEN).
  const levels = parseAreaLevels(input.levels)
  assertGrantableLevels(levels)

  await tx
    .insert(schema.PermissionGrant)
    .values({
      id: generateId(),
      organizationId,
      granteeType: 'profile',
      granteeId: profile.id,
      levels,
      grantedById: input.actorUserId,
    })
    .onConflictDoUpdate({
      target: [
        schema.PermissionGrant.organizationId,
        schema.PermissionGrant.granteeType,
        schema.PermissionGrant.granteeId,
      ],
      set: { levels, grantedById: input.actorUserId, updatedAt: new Date() },
    })
  return true
}
