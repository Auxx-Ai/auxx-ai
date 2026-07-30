// packages/lib/src/permissions/capabilities/compute-user-capabilities.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { ResourceAccessGrantees } from '../../resource-access/grantee-resolution'
import { resourceAccessGranteeConditions } from '../../resource-access/grantee-resolution'
import { loadUserInstanceGrants } from '../../resource-access/instance-grants'
import { resolveBaseProfile } from '../profiles/profile-resolution'
import { composeUserCapabilities, type UserCapabilities } from './compose-user-capabilities'
import { type Area, type Level, parseAreaLevels } from './registry'

const logger = createScopedLogger('user-capabilities')

/**
 * Compute a member's Layer-2 capabilities for one org: cached memberRoleMap
 * (role + seatType + userType + the profile binding) + cached group memberships
 * + the cached `profiles` projection + at most ONE PermissionGrant query
 * (skipped only for OWNER — who short-circuits before the rows are read — and
 * for orgs with zero grants) + ONE type-level and ONE instance-level
 * ResourceAccess query.
 *
 * **DB round-trips are unchanged by permission profiles (doc 19 §8.1):** the
 * profile row → base/ceiling resolution comes from the `profiles` org-cache key,
 * and the binding itself rides the existing `memberRoleMap` entry.
 *
 * Called only by the `userCapabilities` user-cache provider — read it via
 * `getCachedUserCapabilities(userId, orgId)`, not directly.
 */
export async function computeUserCapabilities(
  userId: string,
  organizationId: string,
  db: Database
): Promise<UserCapabilities> {
  // Lazy import to avoid a hard module cycle (cache providers import this file).
  const { getOrgCache, getCachedUserGroupIds } = await import('../../cache')

  const [roleMap, groupIds, hasGrants, profiles] = await Promise.all([
    getOrgCache().get(organizationId, 'memberRoleMap'),
    getCachedUserGroupIds(organizationId, userId),
    getOrgCache().get(organizationId, 'hasPermissionGrants'),
    getOrgCache().get(organizationId, 'profiles'),
  ])

  const entry = roleMap[userId]
  const role = entry?.role
  const seatType = entry?.seatType ?? 'full'
  const isOwner = role === 'OWNER'
  // Principal kind rides the same cached entry — no extra read. `'AGENT'` selects
  // the set-semantics branch in `composeUserCapabilities` (v2 §0.2).
  const userType = entry?.userType ?? 'USER'

  // Non-member: fail closed without touching the DB.
  if (!role)
    return composeUserCapabilities({
      role: undefined,
      seatType,
      userType,
      typeAccessRows: [],
    })

  // The ONE bound human base profile (§1.3): explicit binding, else the system
  // template for (role, seatType), else the ROLE_DEFAULTS runtime fallback.
  // Resolved from cache — no query.
  const baseProfile = resolveBaseProfile({
    organizationId,
    userId,
    role,
    seatType,
    permissionProfileId: entry?.permissionProfileId ?? null,
    profiles,
  })

  // Grantee set shared by both queries: direct user, the bound profile, groups.
  // The old `role:org_member` PermissionGrant tier is GONE (doc 19 §0.8) — the
  // Member profile IS the baseline; migration 041 copied its levels across.
  const grantConditions = [
    and(
      eq(schema.PermissionGrant.granteeType, 'user'),
      eq(schema.PermissionGrant.granteeId, userId)
    ),
  ]
  if (baseProfile.profileId) {
    grantConditions.push(
      and(
        eq(schema.PermissionGrant.granteeType, 'profile'),
        eq(schema.PermissionGrant.granteeId, baseProfile.profileId)
      )
    )
  }
  if (groupIds.length > 0) {
    grantConditions.push(
      and(
        eq(schema.PermissionGrant.granteeType, 'group'),
        inArray(schema.PermissionGrant.granteeId, groupIds)
      )
    )
  }

  // **THE shared ResourceAccess grantee union** (plan v3/03 §11, P4). This used
  // to be an inline copy of `granteeMatchers` — the fourth one — and it had
  // already drifted: it omitted the legacy `team` grantee kind that the mail
  // evaluator matches, so a `team`-granted instance was visible to mail and
  // invisible to capabilities. Routing both queries below through
  // `resourceAccessGranteeConditions` makes "every reader enumerates every
  // grantee kind" a structural property instead of a review item.
  //
  // `role:org_member` STAYS in the union — on this table it is the def/instance
  // baseline marker (lockdown + workspace baseline), a different mechanism from
  // the deleted PermissionGrant policy tier.
  //
  // `profile` is included because `restrictedEntityDefIds` /
  // `governingInstanceIds` are built GRANTEE-AGNOSTICALLY: one profile-grantee
  // type row flips the def to "restricted" org-wide, and `effectiveRecordLevel`
  // then replaces base with the member's own grant. Without reading profile rows
  // here, the def would go dark for every non-admin. (Writes of profile-grantee
  // ResourceAccess rows are refused until doc 19 step 9 updates the other three
  // resolvers — see `assertProfileGranteeSupported`.)
  //
  // Built locally rather than through `resolveResourceAccessGrantees` because the
  // two inputs it would re-resolve from cache — the group ids and the ONE bound
  // base profile — are already in hand above, resolved by the same
  // `resolveBaseProfile`. Same value, two fewer cache reads.
  const grantees: ResourceAccessGrantees = {
    userId,
    groupIds,
    profileId: baseProfile.profileId,
  }
  const accessConditions = resourceAccessGranteeConditions(grantees, { treatTeamAsGroup: true })

  // PermissionGrant query for every principal EXCEPT OWNER, in orgs that
  // actually customized. One sparse-jsonb row per grantee (profile / group / user).
  //
  // **ADMIN loads grant rows** (doc 19 §5.3 piece 2, step 10). It used to be
  // skipped alongside OWNER, which made the `admin` system profile inert: its
  // `PermissionGrant` row was never read, so shaping it changed nothing. The cost
  // is one indexed query admins previously skipped; the gain is that ADMIN
  // capability now flows from `ROLE_DEFAULTS.ADMIN` + the editable `admin`
  // profile instead of a hardcoded bypass.
  //
  // OWNER keeps the skip because it is not a bypass being papered over: the
  // §0.10 recovery guarantee makes `composeUserCapabilities` short-circuit OWNER
  // to ALL_FULL *before* it looks at `profileLevels`/`groupLevels`/`userLevels`,
  // so the rows would be fetched and then provably discarded.
  const grantRowsPromise =
    isOwner || !hasGrants
      ? Promise.resolve([] as Array<{ granteeType: string; granteeId: string; levels: unknown }>)
      : db
          .select({
            granteeType: schema.PermissionGrant.granteeType,
            granteeId: schema.PermissionGrant.granteeId,
            levels: schema.PermissionGrant.levels,
          })
          .from(schema.PermissionGrant)
          .where(
            and(eq(schema.PermissionGrant.organizationId, organizationId), or(...grantConditions))
          )

  // Always ONE type-level ResourceAccess query (entityInstanceId IS NULL) for defAccess.
  const typeAccessPromise = db
    .select({
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      rung: schema.ResourceAccess.rung,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        isNull(schema.ResourceAccess.entityInstanceId),
        or(...accessConditions)
      )
    )

  // The INSTANCE-level read is no longer written here (plan v3/03 §11, P4). It
  // is `loadUserInstanceGrants` — ONE query and ONE bucketing pass, shared with
  // `computeUserInstanceGrants`, whose near-identical query this deletes.
  //
  // Two consequences of unifying on the WIDER of the two shapes:
  //  - the `entityDefinitionId IN (INSTANCE_ACCESS_KEYS)` filter is gone from
  //    SQL, so record-def and mail rows arrive here too. They are dropped in
  //    `flattenBlobLane` / `deriveInstanceReadKeys` by `isInstanceAccessKey`,
  //    which is where §4's "records get no forward cache" invariant now lives;
  //  - `team` rows now reach this composer (see the union note above).
  const instanceGrantsPromise = loadUserInstanceGrants(db, organizationId, grantees)

  const [grantRows, typeAccessRows, instanceGrants] = await Promise.all([
    grantRowsPromise,
    typeAccessPromise,
    instanceGrantsPromise,
  ])

  // Split the sparse-jsonb rows into the composition tiers (§2.1).
  let profileLevels: Partial<Record<Area, Level>> | undefined
  const groupLevels: Array<Partial<Record<Area, Level>>> = []
  let userLevels: Partial<Record<Area, Level>> | undefined
  for (const row of grantRows) {
    const levels = parseAreaLevels(row.levels)
    if (row.granteeType === 'profile') profileLevels = levels
    else if (row.granteeType === 'group') groupLevels.push(levels)
    else if (row.granteeType === 'user') userLevels = levels
    // No silent drops: a widened WHERE clause without a matching tier here is a
    // fetched-and-discarded row, which reads as "the grant does nothing".
    else
      logger.warn('Unhandled PermissionGrant granteeType in composition — row ignored', {
        organizationId,
        userId,
        granteeType: row.granteeType,
        granteeId: row.granteeId,
      })
  }

  return composeUserCapabilities({
    role,
    seatType,
    userType,
    profileLevels,
    profileBaseLevel: baseProfile.baseLevel,
    profileCeiling: baseProfile.ceiling,
    groupLevels,
    userLevels,
    typeAccessRows: typeAccessRows as Array<{
      entityDefinitionId: string
      rung: Rung
    }>,
    instanceGrants,
  })
}
