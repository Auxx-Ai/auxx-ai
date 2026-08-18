// packages/lib/src/cache/invalidate.ts

import type { CacheEvent } from './invalidation-graph'
import { INVALIDATION_GRAPH, isMixedMapping, isOrgOnlyMapping } from './invalidation-graph'
import { getAppCache, getBuildUserCache, getOrgCache, getUserCache } from './singletons'

/**
 * Declarative cache invalidation helper.
 * Call AFTER the DB transaction commits, never inside it.
 *
 * @param context.orgId Required for org/user mappings, optional for build-only events
 * @param context.userId Target user for user/build cache invalidation
 * @param context.userIds Target multiple users (e.g. group membership edits)
 * @param context.broadcastUserKeys If true, invalidate user keys for ALL org members
 * @param context.developerAccountId For build events, invalidate all members of this account
 *
 * @example
 * ```ts
 * await onCacheEvent('plan.changed', { orgId })
 * await onCacheEvent('build.app.created', { developerAccountId: '...' })
 * ```
 */
export async function onCacheEvent(
  event: CacheEvent,
  context: {
    orgId?: string
    userId?: string
    userIds?: string[]
    broadcastUserKeys?: boolean
    developerAccountId?: string
  }
): Promise<void> {
  // Inbox lifecycle reshapes the sidebar counts — bump the mail-counts epoch
  // so every member's counter hash reconciles lazily on next read.
  if (context.orgId && (event === 'inbox.created' || event === 'inbox.deleted')) {
    const { bumpMailCountsEpoch } = await import('../threads/mail-counts')
    void bumpMailCountsEpoch(context.orgId)
  }

  const mapping = INVALIDATION_GRAPH[event]
  if (!mapping) return

  // Visibility recomputes reshape which inboxes/threads count toward badges
  // (§10.1): whenever an event touches `userInstanceGrants`, the affected
  // users' counter hashes are stale too. Epoch bump for broadcasts (lazy
  // reconcile on next read), targeted staleness for specific users.
  const touchesInstanceGrants =
    !!context.orgId &&
    isMixedMapping(mapping) &&
    'user' in mapping &&
    !!mapping.user?.includes('userInstanceGrants')
  if (touchesInstanceGrants && context.orgId) {
    const orgId = context.orgId
    const { bumpMailCountsEpoch, markMailCountsStale } = await import('../threads/mail-counts')
    if (context.broadcastUserKeys) {
      void bumpMailCountsEpoch(orgId)
    } else {
      const userIds = context.userIds ?? (context.userId ? [context.userId] : [])
      if (userIds.length > 0) void markMailCountsStale(orgId, userIds)
    }
  }

  if (isOrgOnlyMapping(mapping)) {
    if (mapping.length > 0 && context.orgId) {
      await getOrgCache().invalidateAndRecompute(context.orgId, mapping)
    }
  } else if (isMixedMapping(mapping)) {
    // Org keys recompute BEFORE user keys: user providers (userInstanceGrants)
    // compose from org keys, so a concurrent recompute could pin stale org
    // data into the user entry until its next invalidation.
    if ('org' in mapping && mapping.org && mapping.org.length > 0 && context.orgId) {
      await getOrgCache().invalidateAndRecompute(context.orgId, mapping.org)
    }

    const promises: Promise<void>[] = []

    if ('user' in mapping && mapping.user && mapping.user.length > 0) {
      if (context.broadcastUserKeys && context.orgId) {
        // Invalidate for ALL org members
        promises.push(getUserCache().invalidateOrgUsersForKeys(context.orgId, mapping.user))
      } else {
        const userIds = context.userIds ?? (context.userId ? [context.userId] : [])
        for (const userId of userIds) {
          promises.push(getUserCache().invalidateAndRecompute(userId, mapping.user, context.orgId))
        }
      }
    }
    if ('build' in mapping && mapping.build && mapping.build.length > 0) {
      if (context.developerAccountId) {
        // Invalidate all members of the developer account
        promises.push(
          getBuildUserCache().invalidateAllMembers(context.developerAccountId, mapping.build)
        )
      } else if (context.userId) {
        // Invalidate for a single user
        promises.push(getBuildUserCache().invalidateAndRecompute(context.userId, mapping.build))
      }
    }

    await Promise.all(promises)
  }

  // Realtime nudge (mail-permissions §6.1): whenever an event reshaped
  // `userInstanceGrants`, tell the affected live clients so they refetch
  // `inbox.myLenses` and re-derive their per-lens channel subscriptions.
  // AFTER the invalidations above, so the refetch reads fresh data.
  // Fire-and-forget — a Pusher hiccup must never fail the mutation.
  if (touchesInstanceGrants && context.orgId) {
    const orgId = context.orgId
    void (async () => {
      // Lazy import — the realtime registry reads this cache module back.
      const { getRealtimeService } = await import('../realtime')
      const { rooms } = await import('../realtime/room-keys')
      const realtime = getRealtimeService()
      const payload = { organizationId: orgId }
      if (context.broadcastUserKeys) {
        await realtime.publish(rooms.orgPresence(orgId), 'visibility:changed', payload)
      } else {
        const userIds = context.userIds ?? (context.userId ? [context.userId] : [])
        await Promise.allSettled(
          userIds.map((userId) =>
            realtime.publish(rooms.user(userId), 'visibility:changed', payload)
          )
        )
      }
    })().catch(() => {})
  }
}

/**
 * Self-heal for the cached channel list: call when a live DB read just refused
 * an action because of channel state (`enabled` / `requiresReauth`) the cached
 * snapshot may not reflect — e.g. sync refused on a disabled channel, send
 * refused on an expired login. Recomputes `channels` only when the cache
 * actually disagrees, so hot paths that keep hitting a broken channel
 * (pollers, retried sends) recompute at most once. Best-effort: a cache
 * hiccup must never mask the caller's real error.
 */
export async function invalidateChannelsIfStale(
  orgId: string,
  channelId: string,
  live: { enabled?: boolean; requiresReauth?: boolean }
): Promise<void> {
  try {
    const channels = await getOrgCache().get(orgId, 'channels')
    const cached = channels.find((c) => c.id === channelId)
    if (!cached) return
    const stale =
      (live.enabled !== undefined && cached.enabled !== live.enabled) ||
      (live.requiresReauth !== undefined && cached.requiresReauth !== live.requiresReauth)
    if (stale) await onCacheEvent('channel.stale-state.detected', { orgId })
  } catch {
    // swallow — self-heal only
  }
}

/** Flush everything for an org (e.g. org deletion) */
export async function flushOrganization(orgId: string): Promise<void> {
  await getOrgCache().flush(orgId)
}

/** Invalidate and recompute cached plans (call after plan admin mutations) */
export async function invalidatePlans(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
}

/** Invalidate and recompute cached workflow templates (call after template admin mutations) */
export async function invalidateWorkflowTemplates(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['workflowTemplates'])
}

/** Invalidate and recompute global app catalog caches (slug map + published apps) */
export async function invalidateAppCatalog(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['appSlugMap', 'publishedApps'])
}

/** Invalidate only the slug map (for mutations that don't affect published state) */
export async function invalidateAppSlugMap(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['appSlugMap'])
}
