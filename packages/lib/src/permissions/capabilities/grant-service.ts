// packages/lib/src/permissions/capabilities/grant-service.ts

import { type Database, database, type PermissionGrantEntity, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { getOrgCache, onCacheEvent } from '../../cache'
import { DehydrationCacheService } from '../../dehydration/cache'
import { ForbiddenError } from '../../errors'
import { FeaturePermissionService } from '../feature-permission-service'
import {
  computeEffectiveStatesUncached,
  type EffectiveState,
  loadActorRole,
  type QueryRunner,
} from '../profiles/effective-state'
import { type ActorAuthority, assertNoEscalation } from '../profiles/escalation-guard'
import { FeatureKey } from '../types'
import { type Area, Level, PERMISSION_AREAS, parseAreaLevels } from './registry'

/**
 * PermissionGrant write service (Layer-2 capability overrides, §7).
 *
 * Leveled model: ONE row per grantee (permission profile, group, or user) holding
 * a sparse per-area level map `{ areaSlug: Level }` as jsonb. Writes upsert on the
 * unique `(organizationId, granteeType, granteeId)` key and emit the
 * `permission-grant.changed` cache event (+ dehydration invalidation) after commit.
 *
 * The seat-ceiling clamp lives at compose time (`composeUserCapabilities`), so no
 * grant row can ever escape a worker seat's ceiling — this service does NOT
 * re-derive that. It only validates that `adminOnly` areas are never raised.
 */

/**
 * Grantee vocabulary shared with `ResourceAccess` (§3.2).
 *
 * `'profile'` (`granteeId` = `PermissionProfile.id`) holds a human profile's
 * per-area BASE — the tier that replaced the deleted `role:org_member` policy
 * (doc 19 §0.8). `'role'` remains only for legacy rows; no composer reads it.
 */
export type GrantGranteeType = 'role' | 'group' | 'user' | 'profile'

/** Identifies one grantee (org-scoped). */
export interface GranteeRef {
  organizationId: string
  granteeType: GrantGranteeType
  granteeId: string
}

/**
 * Reject any grant that raises an `adminOnly` area above `None`. OWNER/ADMIN
 * already hold these by role; granting one to a user, group, or a permission
 * profile would elevate a non-admin past the seat/role model. Mirrors v1's
 * `assertGrantableKey`.
 *
 * **Today that set is `settings` alone.** `permissions` left it in doc 19 §0.25
 * (it must be grantable to be a delegable area) and `billing`/`members` were
 * never `adminOnly` — they are default-`None`-but-grantable, omitted from
 * `MEMBER_BASELINE_LEVELS` in seat-policy.ts (plan 22). §6.1.5's parenthetical
 * listing all four as blocked here does not match the registry; the §6.1
 * escalation guard, not this check, is what keeps `billing`/`members`/
 * `permissions` from being handed out by someone who does not hold them —
 * and since plan 37 that guard runs on {@link setGranteeLevels}'s own `user`
 * path, not only on the profile save. `group` grants remain unguarded (phase 2).
 *
 * The seeded `owner`/`admin` system profiles express "everything" via
 * `PermissionProfile.baseLevel`, NOT an all-Full grant row, so system seeding
 * never trips this.
 *
 * Exported for the doc-19 §6.1.5 transactional profile save, which writes the
 * profile's grant row itself (inside the escalation-guard transaction) and must
 * still run this defense-in-depth check.
 */
export function assertGrantableLevels(levels: Partial<Record<Area, Level>>): void {
  for (const area of Object.keys(levels) as Area[]) {
    if (PERMISSION_AREAS[area].adminOnly && (levels[area] ?? Level.None) > Level.None) {
      throw new ForbiddenError(
        `'${area}' is an admin-only area and cannot be granted; ` +
          'admins and owners already hold it by their role.'
      )
    }
  }
}

/**
 * Drop `Level.None` area entries for grantees whose tier composes **raise-only**,
 * where a stored `None` can never lower anything and is therefore inert noise
 * that makes the grid read as a denial it does not produce (§0.2).
 *
 * Kept (`None` is load-bearing) for exactly these grantee kinds:
 *  - **`profile`** — a human profile supplies the composition BASE
 *    (`base = profileLevels[a] ?? baseLevel ?? ROLE_DEFAULTS[role][a]`, doc 19
 *    §2.1), so a stored `None` genuinely zeroes the area for every holder. This is
 *    the one downward lever, inherited from the deleted `role:org_member` tier.
 *    **Stripping it here would be a fail-open bug:** the area would be written as
 *    "unset", fall through to the role default, and the editor would be showing a
 *    denial the profile does not produce.
 *  - **`role:org_member`** — the legacy org-policy row. No composer reads it
 *    anymore (migration 041 copied it onto the `member` profile), but the
 *    semantics are preserved so a pre-migration row round-trips unchanged.
 *  - **`user` grantees whose `User.userType` is `'AGENT'`** — agents compose by
 *    SET (`level = userLevels[a] ?? Full`), so `None` is the only way to express
 *    "this agent has no access to this area".
 *
 * Stripped for human `user` grantees and all `group` grantees: both tiers are
 * `max(base, grant)`, so `None` is a no-op there.
 */
function stripInertNoneLevels(
  levels: Partial<Record<Area, Level>>,
  keepNone: boolean
): Partial<Record<Area, Level>> {
  if (keepNone) return levels
  const out: Partial<Record<Area, Level>> = {}
  for (const area of Object.keys(levels) as Area[]) {
    const level = levels[area]
    if (level === undefined || level === Level.None) continue
    out[area] = level
  }
  return out
}

/**
 * Whether `Level.None` entries are meaningful for this grantee — see
 * {@link stripInertNoneLevels}. The AGENT check resolves the grantee's
 * `User.userType` from the cached `memberRoleMap` (zero extra DB round-trip);
 * a grantee with no member row is treated as a human (fail closed to the
 * stricter, raise-only interpretation).
 */
async function granteeKeepsNoneLevels(grantee: GranteeRef): Promise<boolean> {
  if (grantee.granteeType === 'profile') return true
  if (grantee.granteeType === 'role') return grantee.granteeId === 'org_member'
  if (grantee.granteeType !== 'user') return false
  const roleMap = await getOrgCache().get(grantee.organizationId, 'memberRoleMap')
  return roleMap[grantee.granteeId]?.userType === 'AGENT'
}

/**
 * Every member whose composed capabilities this grant moves — the holder set the
 * §6.1 escalation guard snapshots either side of the write (plan 37 §3).
 *
 * `null` means "this tier's holders are not resolved here", which **skips the
 * guard**, so every arm returning it owes a reason:
 *
 *  - **`group`** — resolvable and free (invert the cached `groupMembers` map,
 *    plan 37 §2), but the >`HOLDER_GUARD_CAP`-holder fallback is an open
 *    decision (plan 37 §4). Deliberately phase 2; **this is a known open hole**,
 *    not an oversight — a `permissionsManage` holder can still raise a group they
 *    belong to.
 *  - **`profile`** — a profile base is written by `savePermissionProfile`, which
 *    runs the guard over the profile's real holder set. Nothing reaches this
 *    function with a `profile` grantee: #1350 narrowed the router input to
 *    `['group','user']`.
 *  - **`role`** — the legacy `role:org_member` row. No composer reads it, so it
 *    moves nobody's state; it is also off the wire since #1350.
 *
 * The `switch` is exhaustive over {@link GrantGranteeType} on purpose: a new
 * grantee tier is a compile error here rather than a silently unguarded one.
 */
function resolveHolderIds(granteeType: GrantGranteeType, granteeId: string): string[] | null {
  switch (granteeType) {
    case 'user':
      return [granteeId]
    case 'group':
    case 'profile':
    case 'role':
      return null
    default: {
      const unreachable: never = granteeType
      return unreachable
    }
  }
}

/** The pre-write half of the guard: who the actor is, and where the holders stood. */
interface GuardSnapshot {
  actor: ActorAuthority
  before: Map<string, EffectiveState>
}

/**
 * Snapshot the actor's authority and every holder's state **inside the
 * transaction, before the write** (plan 37 §3.1).
 *
 * Both properties are load-bearing and neither is obvious from the call site:
 *
 *  - The actor's authority is their **PRE-write** state, so a grant can never
 *    authorize itself by first raising the actor. `permissions.grant` is gated on
 *    `permissionsManage` alone — nothing stops the actor naming themselves as the
 *    grantee, which is exactly the escalation this closes.
 *  - The snapshots come from `computeEffectiveStatesUncached`, which reads
 *    transaction-locally. Composing through the org cache would return pre-write
 *    values on BOTH sides, the guard would compare a state to itself, and it
 *    would pass unconditionally — green tests over a guard that does nothing.
 */
async function snapshotBeforeWrite(
  tx: QueryRunner,
  organizationId: string,
  holderIds: string[],
  actorUserId: string
): Promise<GuardSnapshot> {
  const actorRole = await loadActorRole(tx, organizationId, actorUserId)
  const before = await computeEffectiveStatesUncached({
    organizationId,
    userIds: [...holderIds, actorUserId],
    tx,
  })
  const actorState = before.get(actorUserId)
  if (!actorState) throw new ForbiddenError('You are not a member of this organization.')
  return { actor: { userId: actorUserId, role: actorRole, state: actorState }, before }
}

/** Enterprise gate — writing override grants requires the plan feature (§2.H/§8). */
async function requireGranularPermissions(db: Database, organizationId: string): Promise<void> {
  await new FeaturePermissionService(db).requireAccess(
    organizationId,
    FeatureKey.granularPermissions
  )
}

/**
 * Emit `permission-grant.changed` + bust dehydration after a grant mutation.
 * User grants target a single user's keys; role/group grants fan out org-wide
 * (`broadcastUserKeys`). Mirrors `emitResourceAccessChanged`. Call AFTER commit.
 *
 * A **`profile`** grantee takes the doc-19 §8.3 audience instead of the org-wide
 * `else`: its holders are the explicitly-bound members PLUS — for a system
 * profile — every null-bound member whose `(role, seatType)` resolves to that
 * slug. Falling into the blind broadcast would still work but would churn every
 * blob in the org; missing the null-bound half would silently reach nobody.
 */
async function emitGrantChanged(grantee: GranteeRef): Promise<void> {
  const dehydration = new DehydrationCacheService()
  // Lazy import — the cache invalidation path lazily imports realtime, so this
  // module must not statically import the realtime barrel back (import cycle).
  const { getRealtimeService, publishCapabilitiesChanged } = await import('../../realtime')

  if (grantee.granteeType === 'profile') {
    const { fanOutCapabilityChange, resolveProfileAudience } = await import(
      '../profiles/profile-invalidation'
    )
    const audience = await resolveProfileAudience({
      organizationId: grantee.organizationId,
      profileId: grantee.granteeId,
    })
    await fanOutCapabilityChange('permission-grant.changed', grantee.organizationId, audience)
    return
  }

  if (grantee.granteeType === 'user') {
    await onCacheEvent('permission-grant.changed', {
      orgId: grantee.organizationId,
      userId: grantee.granteeId,
    })
    await dehydration.invalidateUser(grantee.granteeId)
    // UX-only live merge: nudge just that user's client to refetch.
    await publishCapabilitiesChanged(getRealtimeService(), { userId: grantee.granteeId })
    return
  }

  // role/group grants fan out to every member.
  await onCacheEvent('permission-grant.changed', {
    orgId: grantee.organizationId,
    broadcastUserKeys: true,
  })
  await dehydration.invalidateOrganization(grantee.organizationId)
  // Org-wide grant → nudge every open client in the org.
  await publishCapabilitiesChanged(getRealtimeService(), { orgId: grantee.organizationId })
}

/**
 * Set (upsert) the sparse per-area levels for one grantee. Normalizes the input
 * through {@link parseAreaLevels} (drops unknown areas, clamps each value),
 * validates admin-only areas, gates on the `granularPermissions` feature, then
 * upserts the single grantee row. Only the areas present in `levels` are stored;
 * absent areas fall through to the code default at compose time. Passing `{}`
 * writes an empty override row; prefer {@link clearGranteeLevels} to remove it.
 *
 * `Level.None` entries are stripped for grantees whose tier composes raise-only
 * (human users, groups) and kept for `profile` grantees (the composition base),
 * the legacy `role:org_member` policy, and AGENT user grantees — see
 * {@link stripInertNoneLevels}.
 *
 * **The write runs inside a transaction carrying the §6.1 escalation guard**
 * (plan 37) for every grantee tier {@link resolveHolderIds} can enumerate —
 * today `user`. `assertGrantableLevels` blocks only the single `adminOnly` area,
 * so without this a `permissionsManage` holder could grant themselves
 * `billing`/`members`/`permissions` outright. `group` grants are **not guarded
 * yet** — see {@link resolveHolderIds}.
 */
export async function setGranteeLevels(
  input: GranteeRef & {
    levels: Partial<Record<Area, Level>>
    grantedById: string
    db?: Database
  }
): Promise<PermissionGrantEntity> {
  const { organizationId, granteeType, granteeId, grantedById } = input
  const db = input.db ?? database

  const parsed = parseAreaLevels(input.levels)
  assertGrantableLevels(parsed)
  // Both of these read Redis. They are resolved BEFORE the transaction opens:
  // a cache round trip inside one holds the grant row's lock for a network hop.
  const levels = stripInertNoneLevels(
    parsed,
    await granteeKeepsNoneLevels({ organizationId, granteeType, granteeId })
  )
  await requireGranularPermissions(db, organizationId)
  const holderIds = resolveHolderIds(granteeType, granteeId)

  const row = await db.transaction(async (tx) => {
    const guard = holderIds
      ? await snapshotBeforeWrite(tx, organizationId, holderIds, grantedById)
      : null

    const [written] = await tx
      .insert(schema.PermissionGrant)
      .values({
        id: generateId(),
        organizationId,
        granteeType,
        granteeId,
        levels,
        grantedById,
      })
      .onConflictDoUpdate({
        target: [
          schema.PermissionGrant.organizationId,
          schema.PermissionGrant.granteeType,
          schema.PermissionGrant.granteeId,
        ],
        set: {
          levels,
          grantedById,
          updatedAt: new Date(),
        },
      })
      .returning()

    if (guard && holderIds) {
      const after = await computeEffectiveStatesUncached({ organizationId, userIds: holderIds, tx })
      // The throw IS the rollback — there is no compensating write. A raise the
      // actor does not hold themselves leaves no row behind.
      assertNoEscalation({ actor: guard.actor, before: guard.before, after })
    }

    return written
  })

  // Outside the transaction on purpose: this fires cache invalidation and
  // realtime, so running it inside would leave the org's caches busted for a
  // write the guard rolled back.
  await emitGrantChanged({ organizationId, granteeType, granteeId })
  return row as PermissionGrantEntity
}

/**
 * Remove the grant row for one grantee. Removal only tightens access, so — like
 * ResourceAccess revoke — it is NOT plan-gated. Returns whether a row was removed.
 */
export async function clearGranteeLevels(input: GranteeRef & { db?: Database }): Promise<boolean> {
  const { organizationId, granteeType, granteeId } = input
  const db = input.db ?? database

  const result = await db
    .delete(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, granteeType),
        eq(schema.PermissionGrant.granteeId, granteeId)
      )
    )
    .returning({ id: schema.PermissionGrant.id })

  if (result.length > 0) {
    await emitGrantChanged({ organizationId, granteeType, granteeId })
  }
  return result.length > 0
}

/**
 * Read the sparse per-area levels currently stored for one grantee, or
 * `undefined` when no row exists (grantee falls through to the code default /
 * policy at compose time). The stored value is coerced via {@link parseAreaLevels}.
 */
export async function getGranteeLevels(
  input: GranteeRef & { db?: Database }
): Promise<Partial<Record<Area, Level>> | undefined> {
  const { organizationId, granteeType, granteeId } = input
  const db = input.db ?? database

  const [row] = await db
    .select({ levels: schema.PermissionGrant.levels })
    .from(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, granteeType),
        eq(schema.PermissionGrant.granteeId, granteeId)
      )
    )
    .limit(1)

  if (!row) return undefined
  return parseAreaLevels(row.levels)
}

/** One stored grantee row, coerced to a trusted sparse levels map. */
export interface GranteeGrant {
  granteeType: GrantGranteeType
  granteeId: string
  levels: Partial<Record<Area, Level>>
}

/**
 * List every stored grant row for an organization (profile + group + user, plus
 * any legacy role row), each coerced through {@link parseAreaLevels}. Powers the
 * permissions settings page — one query hydrates every profile base and all
 * group/user overrides.
 */
export async function listGranteeGrants(
  organizationId: string,
  db: Database = database
): Promise<GranteeGrant[]> {
  const rows = await db
    .select({
      granteeType: schema.PermissionGrant.granteeType,
      granteeId: schema.PermissionGrant.granteeId,
      levels: schema.PermissionGrant.levels,
    })
    .from(schema.PermissionGrant)
    .where(eq(schema.PermissionGrant.organizationId, organizationId))

  return rows.map((row) => ({
    granteeType: row.granteeType,
    granteeId: row.granteeId,
    levels: parseAreaLevels(row.levels),
  }))
}

/** An empty sparse levels payload (no area overrides — everything falls through). */
export function emptyLevels(): Partial<Record<Area, Level>> {
  return {}
}
