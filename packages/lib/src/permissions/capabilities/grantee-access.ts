// packages/lib/src/permissions/capabilities/grantee-access.ts

import { type Database, database, schema } from '@auxx/database'
import type { ResourcePermission, Rung } from '@auxx/database/enums'
import { and, eq, or } from 'drizzle-orm'
import { getCachedPermissionProfiles } from '../../cache'
import { getCapabilities } from './get-capabilities'
import {
  INSTANCE_ACCESS_KEYS,
  type InstanceAccessKey,
  isInstanceAccessKey,
} from './instance-access'
import { AREA_ORDER, type Area, type Level, parseAreaLevels } from './registry'
import { rungToPermission } from './rung'

/** Who a grantee page is about. Mirrors the `ResourceAccess`/`PermissionGrant` grantee axis. */
export type AccessGranteeType = 'user' | 'group' | 'profile'

/**
 * The `ResourceAccess` address of the workspace default (plan 16's aggregate
 * view). Still live and load-bearing on THIS table — unlike the identically
 * named `PermissionGrant` tier, which plan 19 §0.8 deleted and no composer reads.
 */
const WORKSPACE_BASELINE_GRANTEE_TYPE = 'role'
const WORKSPACE_BASELINE_GRANTEE_ID = 'org_member'

/**
 * The `PermissionProfile.slug` that IS the org-wide area-level baseline
 * (doc 19 §0.8) — what every override grid measures "raise only" against.
 */
const MEMBER_PROFILE_SLUG = 'member'

/**
 * The rows keyed to THIS grantee — what the Access grids' selects read and write.
 * Sparse throughout: an absent key means "no explicit row", which every surface
 * renders as *Inherit*.
 */
export interface GranteeOwnAccess {
  /** The grantee's own `PermissionGrant.levels`, per L2 area. */
  areas: Partial<Record<Area, Level>>
  /**
   * Their type-level `ResourceAccess` rows, keyed by `entityDefinitionId`, on
   * the DEF axis — the stored rung crossed through `rungToPermission` (a type
   * row below `read` has no def-axis tier and is dropped).
   */
  defs: Record<string, ResourcePermission>
  /** Their instance-level `ResourceAccess` rows, keyed by instance id, as stored. */
  instances: Record<string, Rung>
}

/**
 * What the grantee can ACTUALLY reach, composed through the same predicates the
 * read path enforces — never a second implementation of the composition rules.
 *
 * `null` means *no access*, distinct from an absent key: the maps below are total
 * over what they cover, so a client reading them never has to decide what a hole
 * means.
 */
export interface GranteeEffectiveAccess {
  /** Composed level per L2 area — total over {@link AREA_ORDER}. */
  areas: Record<Area, Level>
  /** Composed type-level permission per `entityDefinitionId` that has any row. */
  defs: Record<string, ResourcePermission | null>
  /**
   * Composed permission for every instance the ORG holds a row on (any grantee).
   * An instance absent here has no row anywhere, so its answer is
   * {@link instanceFallback} for its resource type — the client's lookup is
   * `instances[id] ?? instanceFallback[key]`, a pure lookup with no math.
   */
  instances: Record<string, Rung | null>
  /** The answer for a row-less instance, per resource type. */
  instanceFallback: Record<InstanceAccessKey, Rung | null>
}

/**
 * The org's `role:org_member` workspace defaults — one row per def/instance,
 * NOT per grantee.
 *
 * Plan 31 §2.4 omits this, and that is a gap in the plan rather than a decision:
 * the grantee def grid renders `baselineLevel` / `isLockedDown` / the resolved
 * *Inherit* value for every row, and all three come from these rows. Dropping
 * them would have replaced a scope leak with a blank column.
 *
 * Including them is not a reintroduction of what §2.4 removes. The shape finding
 * is about *every grantee's* rows sitting in a member page's cache — the thing
 * that made the §2.1 leak buildable. A workspace default is a single org-wide
 * fact the grid already states out loud, with no grantee in it.
 */
export interface GranteeBaselineAccess {
  /**
   * The **Member profile**'s own sparse area levels — the org-wide floor an
   * override grid renders its *Inherit* fall-through from, and the level
   * `useGranteeDefAccess` maps to a record permission for an unconfigured def.
   *
   * Same "one org-wide fact, no grantee in it" argument as {@link defs} below,
   * one layer up: it is a single row, and every grid that reads it already
   * states it out loud.
   *
   * **Levels only, deliberately — not the profile's `baseLevel`, and not the
   * grantee's actually-bound profile.** Both are faithful to what the client
   * derived from `listGrants` before this field existed, and neither is quite
   * the truth: a member bound to a custom profile falls through to THAT
   * profile, not to Member. The grids do not lie about it, because the composed
   * `effective.areas` line (#1352) sits on the same row and wins any
   * disagreement — but if that fall-through is ever made accurate, this is the
   * field to change, and the copy above the grid ("raise access above the
   * member baseline") has to move with it.
   */
  areas: Partial<Record<Area, Level>>
  defs: Record<string, ResourcePermission>
  instances: Record<string, Rung>
}

export interface GranteeAccess {
  own: GranteeOwnAccess
  baseline: GranteeBaselineAccess
  /**
   * `null` for `group` and `profile` grantees.
   *
   * They are level *sources*, not subjects: a group does not "have" effective
   * access, its members do, and composing one would mean inventing a fictional
   * member. This is the same distinction the grids' existing `isUser` prop
   * already encodes for the dead-grant warning (plan 31 §2.4) — reuse it rather
   * than adding a second flag.
   */
  effective: GranteeEffectiveAccess | null
}

/**
 * Everything one grantee page needs, for ONE grantee (plan 31 §2.4).
 *
 * Replaces three org-wide reads the grantee pages used to do and filter
 * client-side — `permissions.listGrants`, `resourceAccess.allTypeAccess` and
 * `resourceAccess.allInstanceAccess`, each returning every row for every grantee
 * in the org. Those were properly gated, so this is not a fix for a broken
 * authorization check; it is a fix for the SHAPE. Having the org's whole grant
 * table sitting in a member page's query cache is what made the §2.1 scope leak
 * buildable in the first place, and is what the next row would have reached for.
 *
 * **`effective` is a thin wrapper over machinery that already exists and is
 * already cached.** `getCapabilities` reads the composed blob at
 * `user:capabilities:v11` (one user-cache read, L1-fronted), and
 * `CapabilitySet.instanceLevel` is the enforcement predicate itself. Nothing here
 * re-derives a composition rule, which is why this addition needs **no cache
 * bump**: it reads the existing blob unchanged.
 *
 * Two DB reads, both org-scoped and indexed: the `PermissionGrant` rows at two
 * addresses (this grantee's, and the Member profile's — see
 * {@link GranteeBaselineAccess.areas}), and the org's `ResourceAccess` rows. The
 * latter stays org-wide because `effective.instances` must cover every instance
 * the org manages a row on — but it never leaves this function; only one
 * grantee's levels go over the wire.
 */
export async function getGranteeAccess(
  params: {
    organizationId: string
    granteeType: AccessGranteeType
    granteeId: string
  },
  db: Database = database
): Promise<GranteeAccess> {
  const { organizationId, granteeType, granteeId } = params

  // Cache read, not a query — the same `profiles` org-cache entry
  // `computeUserCapabilities` resolves the bound base profile from, so the id
  // this finds is the id composition uses.
  const profiles = await getCachedPermissionProfiles(organizationId)
  const memberProfileId = profiles.find((p) => p.slug === MEMBER_PROFILE_SLUG)?.id ?? null

  // Two addresses, one query: this grantee's row and the Member profile's. When
  // the grantee IS the Member profile they are the same row, and it correctly
  // lands in both halves.
  const grantAddresses = [
    and(
      eq(schema.PermissionGrant.granteeType, granteeType),
      eq(schema.PermissionGrant.granteeId, granteeId)
    ),
  ]
  if (memberProfileId) {
    grantAddresses.push(
      and(
        eq(schema.PermissionGrant.granteeType, 'profile'),
        eq(schema.PermissionGrant.granteeId, memberProfileId)
      )
    )
  }

  const [grantRows, accessRows] = await Promise.all([
    db
      .select({
        granteeType: schema.PermissionGrant.granteeType,
        granteeId: schema.PermissionGrant.granteeId,
        levels: schema.PermissionGrant.levels,
      })
      .from(schema.PermissionGrant)
      .where(and(eq(schema.PermissionGrant.organizationId, organizationId), or(...grantAddresses))),
    db
      .select({
        entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
        entityInstanceId: schema.ResourceAccess.entityInstanceId,
        granteeType: schema.ResourceAccess.granteeType,
        granteeId: schema.ResourceAccess.granteeId,
        rung: schema.ResourceAccess.rung,
      })
      .from(schema.ResourceAccess)
      .where(eq(schema.ResourceAccess.organizationId, organizationId)),
  ])

  let ownLevels: unknown
  let baselineLevels: unknown
  for (const row of grantRows) {
    if (row.granteeType === granteeType && row.granteeId === granteeId) ownLevels = row.levels
    if (row.granteeType === 'profile' && row.granteeId === memberProfileId)
      baselineLevels = row.levels
  }

  const own: GranteeOwnAccess = {
    areas: parseAreaLevels(ownLevels),
    defs: {},
    instances: {},
  }
  const baseline: GranteeBaselineAccess = {
    areas: parseAreaLevels(baselineLevels),
    defs: {},
    instances: {},
  }

  /** Instance id → its resource type, so each id is resolved against its OWN area. */
  const keyOfInstance = new Map<string, InstanceAccessKey>()

  for (const row of accessRows) {
    if (row.entityInstanceId && isInstanceAccessKey(row.entityDefinitionId)) {
      keyOfInstance.set(row.entityInstanceId, row.entityDefinitionId)
    }
    const isBaselineRow =
      row.granteeType === WORKSPACE_BASELINE_GRANTEE_TYPE &&
      row.granteeId === WORKSPACE_BASELINE_GRANTEE_ID
    // Instance rows are stored rungs; TYPE rows cross to the def axis here (see
    // `rungToPermission`). A type row below `read` has no def-axis tier — it is
    // dropped rather than rounded up, which is the fail-closed direction.
    const defPermission = row.entityInstanceId ? undefined : rungToPermission(row.rung)
    if (isBaselineRow) {
      if (row.entityInstanceId) baseline.instances[row.entityInstanceId] = row.rung
      else if (defPermission !== undefined) baseline.defs[row.entityDefinitionId] = defPermission
    }
    if (row.granteeType !== granteeType || row.granteeId !== granteeId) continue
    if (row.entityInstanceId) own.instances[row.entityInstanceId] = row.rung
    else if (defPermission !== undefined) own.defs[row.entityDefinitionId] = defPermission
  }

  // A group/profile has no composed capability set of its own — see `effective`.
  if (granteeType !== 'user') return { own, baseline, effective: null }

  const caps = await getCapabilities(granteeId, organizationId)

  const areas = {} as Record<Area, Level>
  for (const area of AREA_ORDER) areas[area] = caps.areaLevel(area)

  const defs: Record<string, ResourcePermission | null> = {}
  for (const row of accessRows) {
    if (row.entityInstanceId) continue
    defs[row.entityDefinitionId] ??= caps.viewAccessFor(row.entityDefinitionId) ?? null
  }

  const instances: Record<string, Rung | null> = {}
  for (const [instanceId, key] of keyOfInstance) {
    instances[instanceId] = caps.instanceLevel(key, instanceId) ?? null
  }

  const instanceFallback = {} as Record<InstanceAccessKey, Rung | null>
  for (const key of INSTANCE_ACCESS_KEYS) {
    instanceFallback[key] = caps.instanceFallbackLevel(key) ?? null
  }

  return { own, baseline, effective: { areas, defs, instances, instanceFallback } }
}
