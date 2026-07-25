// packages/lib/src/resource-access/grantee-resolution.ts

import { schema } from '@auxx/database'
import { ResourceGranteeType } from '@auxx/database/enums'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import type { MemberRoleEntry } from '../cache/org-cache-keys'
import { resolveBaseProfile } from '../permissions/profiles/profile-resolution'
import type { CachedPermissionProfile } from '../permissions/profiles/types'

/**
 * The ONE place the server resolves **which `ResourceAccess` grantee rows apply
 * to a member** (doc 19 §8.2 / 19a findings 1 + 3 + 4).
 *
 * Before this module the grantee union was copy-pasted into four resolvers
 * (`checkAccess`, `checkTypeAccess`, `getUserAccessibleInstances`,
 * `computeUserMailVisibility`) plus a ternary in the reverse mail index — and
 * three of them had drifted. That mattered far more than duplication normally
 * does: `restrictedEntityDefIds` / `restrictedInstanceIds` build the restricted
 * set **grantee-agnostically**, so a grantee kind a reader cannot resolve does
 * not fail "closed for that grantee" — it flips the definition to restricted for
 * the whole org while granting nobody, i.e. an org-wide lockout.
 *
 * `role:org_member` STAYS in the union (doc 19 §11a deviation 2). On
 * `ResourceAccess` it is the def/workspace-baseline marker, a different
 * mechanism from the `PermissionGrant` policy tier that plan 19 deleted.
 */

/** The `ResourceAccess.granteeId` of the org-wide workspace baseline row. */
export const ORG_MEMBER_GRANTEE_ID = 'org_member'

/** Every grantee identity one member matches `ResourceAccess` rows on. */
export interface ResourceAccessGrantees {
  userId: string
  /** Entity-group instance ids the user belongs to. */
  groupIds: string[]
  /**
   * The member's ONE resolved base permission profile (§1.3) — an explicit
   * binding, else the system template for `(role, seatType)`. `null` when the
   * user is not a member of the org or nothing resolved (unseeded org).
   */
  profileId: string | null
}

/**
 * Resolve one member's grantee identities from the org cache — zero DB queries
 * (`groupMembers`, `memberRoleMap` and `profiles` are all cached org keys).
 *
 * The profile half deliberately mirrors `computeUserCapabilities`: it goes
 * through {@link resolveBaseProfile}, so a profile-grantee row is seen by the
 * exact same profile the capability composer would have used. Anything else
 * would let the two disagree about who a profile grant reaches.
 */
export async function resolveResourceAccessGrantees(
  organizationId: string,
  userId: string
): Promise<ResourceAccessGrantees> {
  // Lazy import — cache providers import this module's consumers, so a static
  // import of the cache barrel would close a module cycle.
  const { getCachedUserGroupIds } = await import('../cache')
  const [groupIds, profileId] = await Promise.all([
    getCachedUserGroupIds(organizationId, userId),
    resolveUserProfileId(organizationId, userId),
  ])
  return { userId, groupIds, profileId }
}

/**
 * The member's resolved base permission profile id, or `null` when they are not
 * a member / the org has no seeded profiles. Cache-only.
 */
export async function resolveUserProfileId(
  organizationId: string,
  userId: string
): Promise<string | null> {
  const { getOrgCache } = await import('../cache')
  const [roleMap, profiles] = await Promise.all([
    getOrgCache().get(organizationId, 'memberRoleMap'),
    getOrgCache().get(organizationId, 'profiles'),
  ])
  const entry = roleMap[userId]
  if (!entry) return null
  return resolveBaseProfile({
    organizationId,
    userId,
    role: entry.role,
    seatType: entry.seatType,
    permissionProfileId: entry.permissionProfileId,
    profiles,
  }).profileId
}

/**
 * Invert the org's `memberRoleMap` into `userId → resolved profile id`, skipping
 * users nothing resolved for.
 *
 * This is the **read-side** expansion of a profile grantee and is intentionally
 * built on {@link resolveBaseProfile} rather than on
 * `permissions/profiles/resolveProfileHolderIds`: that one is the *invalidation
 * / escalation-guard* sweep (who to bust caches for), while this one must agree
 * with the forward resolver **exactly**, including the null-bound majority — a
 * profile-grantee row naming a system profile reaches every member whose null
 * binding resolves to it.
 */
export function resolveProfileIdByUser(input: {
  organizationId: string
  roleMap: Record<string, MemberRoleEntry>
  profiles: readonly CachedPermissionProfile[]
}): Record<string, string> {
  const byUser: Record<string, string> = {}
  for (const [userId, entry] of Object.entries(input.roleMap)) {
    const resolved = resolveBaseProfile({
      organizationId: input.organizationId,
      userId,
      role: entry.role,
      seatType: entry.seatType,
      permissionProfileId: entry.permissionProfileId,
      profiles: input.profiles,
    })
    if (resolved.profileId) byUser[userId] = resolved.profileId
  }
  return byUser
}

/** Every member whose resolved base profile is `profileId`. Cache-only. */
export async function resolveProfileHolders(
  organizationId: string,
  profileId: string
): Promise<string[]> {
  const { getOrgCache } = await import('../cache')
  const [roleMap, profiles] = await Promise.all([
    getOrgCache().get(organizationId, 'memberRoleMap'),
    getOrgCache().get(organizationId, 'profiles'),
  ])
  const byUser = resolveProfileIdByUser({ organizationId, roleMap, profiles })
  return Object.keys(byUser).filter((userId) => byUser[userId] === profileId)
}

/**
 * One `(granteeType…, granteeId…)` pair a member's `ResourceAccess` rows may
 * match on. `granteeTypes` holds more than one entry only for the mail
 * evaluator's legacy `team`-as-group behaviour.
 */
export interface GranteeMatcher {
  granteeTypes: ResourceGranteeType[]
  granteeIds: string[]
}

/**
 * The grantee union for one member, as data — direct user grant, the
 * `role:org_member` baseline, the bound permission profile, and group grants.
 *
 * Split out of {@link resourceAccessGranteeConditions} so the union itself is
 * testable: under the default Vitest config `@auxx/database`'s `schema` is a
 * Proxy whose columns are `undefined`, so asserting on built Drizzle predicates
 * passes vacuously. This function has no Drizzle in it.
 *
 * `treatTeamAsGroup` reproduces the mail evaluator's historical behaviour of
 * matching legacy `team` rows against the same group-instance ids.
 */
export function granteeMatchers(
  grantees: ResourceAccessGrantees,
  opts: { treatTeamAsGroup?: boolean } = {}
): GranteeMatcher[] {
  const matchers: GranteeMatcher[] = [
    { granteeTypes: [ResourceGranteeType.user], granteeIds: [grantees.userId] },
    { granteeTypes: [ResourceGranteeType.role], granteeIds: [ORG_MEMBER_GRANTEE_ID] },
  ]

  if (grantees.profileId) {
    matchers.push({
      granteeTypes: [ResourceGranteeType.profile],
      granteeIds: [grantees.profileId],
    })
  }

  if (grantees.groupIds.length > 0) {
    matchers.push({
      granteeTypes: opts.treatTeamAsGroup
        ? [ResourceGranteeType.group, ResourceGranteeType.team]
        : [ResourceGranteeType.group],
      granteeIds: grantees.groupIds,
    })
  }

  return matchers
}

/**
 * The `OR`-able `ResourceAccess` grantee predicates for one member — the SQL
 * projection of {@link granteeMatchers}.
 */
export function resourceAccessGranteeConditions(
  grantees: ResourceAccessGrantees,
  opts: { treatTeamAsGroup?: boolean } = {}
): Array<SQL | undefined> {
  return granteeMatchers(grantees, opts).map((matcher) =>
    and(
      matcher.granteeTypes.length === 1
        ? eq(schema.ResourceAccess.granteeType, matcher.granteeTypes[0]!)
        : inArray(schema.ResourceAccess.granteeType, matcher.granteeTypes),
      matcher.granteeIds.length === 1
        ? eq(schema.ResourceAccess.granteeId, matcher.granteeIds[0]!)
        : inArray(schema.ResourceAccess.granteeId, matcher.granteeIds)
    )
  )
}

/**
 * How a grant row attributes in {@link import('./types').AccessCheckResult}.
 * Total over the grantee vocabulary so a new kind cannot silently report as
 * `'direct'` (19a #27).
 */
export function grantedViaFor(
  granteeType: string
): 'direct' | 'group' | 'team' | 'role' | 'profile' {
  switch (granteeType) {
    case ResourceGranteeType.user:
      return 'direct'
    case ResourceGranteeType.group:
      return 'group'
    case ResourceGranteeType.team:
      return 'team'
    case ResourceGranteeType.profile:
      return 'profile'
    default:
      return 'role'
  }
}
