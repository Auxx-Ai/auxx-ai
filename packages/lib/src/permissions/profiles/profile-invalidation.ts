// packages/lib/src/permissions/profiles/profile-invalidation.ts

import { createScopedLogger } from '@auxx/logger'
import { getOrgCache, onCacheEvent } from '../../cache'
import { DehydrationCacheService } from '../../dehydration/cache'
import { systemProfileFor } from './system-profiles'

const logger = createScopedLogger('permission-profiles')

/**
 * Above this many affected members, targeted per-user invalidation stops being
 * cheaper than the org-wide broadcast the cache/realtime layers already support.
 *
 * **Distinct from the §6.1.3 guard cap of 500 holders**, which is a *security*
 * budget (above it the escalation guard stops composing per-holder states and
 * falls back to the strict profile-map check). This one is a *cache* budget:
 * crossing it only changes how invalidation is delivered, never what is allowed.
 * They are deliberately different numbers for different reasons — do not merge.
 */
const BROADCAST_THRESHOLD = 50

/** Who a profile change reaches, and how to reach them. */
export interface ProfileAudience {
  /** Explicit user ids to invalidate. Empty when {@link ProfileAudience.broadcast} is true. */
  userIds: string[]
  /** Invalidate + publish org-wide instead of enumerating users. */
  broadcast: boolean
}

/**
 * Resolve who a permission-profile change affects — **the null-bound-holder trap
 * (§8.3)**.
 *
 * Every migrated principal keeps a `null` binding, so sweeping only
 * explicitly-bound holders would mean editing the **Member** profile reaches
 * NOBODY while most users sit on a stale capability blob for the full `ONE_DAY`
 * TTL. A **system-profile** edit must therefore additionally fan out by
 * *(role, seatType)* — the exact pair {@link systemProfileFor} resolves.
 *
 * Both halves come from the cached `memberRoleMap` (which carries `role`,
 * `seatType` and `permissionProfileId`), so this costs zero queries. The §1.1
 * `(organizationId, permissionProfileId)` indexes back the same sweep for the
 * transactional delete path, where a cache read would be unsafe.
 *
 * Falls back to a safe org-wide broadcast when the profile can't be classified
 * (e.g. it was just deleted) or when the affected set is large enough that
 * enumerating it buys nothing.
 */
export async function resolveProfileAudience(input: {
  organizationId: string
  profileId: string
  /** Skips the cache lookup when the caller already has the row. */
  slug?: string
  isSystem?: boolean
}): Promise<ProfileAudience> {
  const userIds = await resolveProfileHolderIds(input)
  // `null` = the profile could not be classified; never guess narrow.
  if (userIds === null) return { userIds: [], broadcast: true }
  if (userIds.length > BROADCAST_THRESHOLD) return { userIds: [], broadcast: true }
  return { userIds, broadcast: false }
}

/**
 * The raw §6.1.3 affected-holder sweep — every user id a change to this profile
 * reaches, **uncollapsed**. `null` means the profile could not be classified
 * (deleted, or a stale projection), which the invalidation path turns into an
 * org-wide broadcast and the escalation guard must treat as "unknown holders".
 *
 * Split out of {@link resolveProfileAudience} so the §6.1 escalation guard and
 * the §8.3 invalidation share ONE sweep — including the null-bound majority,
 * which no index can return. The audience wrapper collapses a large result to a
 * broadcast; the guard needs the ids themselves, so it calls this directly.
 */
export async function resolveProfileHolderIds(input: {
  organizationId: string
  profileId: string
  /** Skips the cache lookup when the caller already has the row. */
  slug?: string
  isSystem?: boolean
}): Promise<string[] | null> {
  const { organizationId, profileId } = input

  let slug = input.slug
  let isSystem = input.isSystem
  if (slug === undefined || isSystem === undefined) {
    const profiles = await getOrgCache().get(organizationId, 'profiles')
    const row = profiles.find((p) => p.id === profileId)
    if (!row) {
      logger.warn('Permission profile not found for holder sweep', {
        organizationId,
        profileId,
      })
      return null
    }
    slug = row.slug
    isSystem = row.isSystem
  }

  const roleMap = await getOrgCache().get(organizationId, 'memberRoleMap')
  const userIds: string[] = []
  for (const [userId, entry] of Object.entries(roleMap)) {
    if (entry.permissionProfileId === profileId) {
      userIds.push(userId)
      continue
    }
    // Null-bound holders: they resolve to a system slug in code, so a system
    // profile edit reaches them even though no row points at it.
    if (isSystem && !entry.permissionProfileId) {
      if (systemProfileFor(entry.role, entry.seatType) === slug) userIds.push(userId)
    }
  }
  return userIds
}

/**
 * Emit `permission-profile.changed` for a profile mutation — busts the org's
 * `profiles` projection, recomputes every affected member's `userCapabilities`,
 * and nudges their live clients to refetch (doc 01 §1.3 pattern). Call AFTER
 * commit.
 *
 * Audience comes from {@link resolveProfileAudience}, so a system-profile edit
 * reaches null-bound holders too. Pass `audience` when the caller already
 * captured it inside a transaction (profile deletion must capture holders BEFORE
 * nulling their bindings, then invalidate AFTER commit).
 */
export async function emitPermissionProfileChanged(input: {
  organizationId: string
  profileId: string
  slug?: string
  isSystem?: boolean
  audience?: ProfileAudience
}): Promise<void> {
  const { organizationId } = input
  const audience = input.audience ?? (await resolveProfileAudience(input))
  await fanOutCapabilityChange('permission-profile.changed', organizationId, audience)
}

/**
 * Shared fan-out for the two events that reshape composed capabilities through a
 * profile: `permission-profile.changed` (the profile row / agent policy) and
 * `permission-grant.changed` with a `profile` grantee (its area levels).
 */
export async function fanOutCapabilityChange(
  event: 'permission-profile.changed' | 'permission-grant.changed',
  organizationId: string,
  audience: ProfileAudience
): Promise<void> {
  const dehydration = new DehydrationCacheService()
  // Lazy import — cache invalidation lazily imports realtime, so this module must
  // not statically import the realtime barrel back (import cycle).
  const { getRealtimeService, publishCapabilitiesChanged } = await import('../../realtime')

  if (audience.broadcast) {
    await onCacheEvent(event, { orgId: organizationId, broadcastUserKeys: true })
    await dehydration.invalidateOrganization(organizationId)
    await publishCapabilitiesChanged(getRealtimeService(), { orgId: organizationId })
    return
  }

  // The org keys on the mapping still need to recompute even with nobody bound.
  await onCacheEvent(event, { orgId: organizationId, userIds: audience.userIds })
  if (audience.userIds.length === 0) return

  await Promise.all(audience.userIds.map((userId) => dehydration.invalidateUser(userId)))
  const realtime = getRealtimeService()
  await Promise.all(
    audience.userIds.map((userId) => publishCapabilitiesChanged(realtime, { userId }))
  )
}
