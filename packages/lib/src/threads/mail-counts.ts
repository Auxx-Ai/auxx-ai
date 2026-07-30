// packages/lib/src/threads/mail-counts.ts
//
// Delta-maintained sidebar counts. One Redis hash per (org, user) holds every
// badge; mutations apply atomic HINCRBY deltas; a lazily-enqueued reconcile job
// recounts from Postgres and overwrites the hash. Read path is a single
// roundtrip — no SQL. Accuracy contract: drift is bounded by the reconcile
// interval, never permanent.

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { counterHash } from '../cache/counter-cache'
import type { FullCountsResponse } from './types'
import { UnreadService } from './unread-service'

const logger = createScopedLogger('mail-counts')

/** Recount when a hash's last full compute is older than this. */
const RECONCILE_INTERVAL_MS = 5 * 60_000
/** Idle users' hashes evaporate; next visit reseeds inline. */
const TTL_SECONDS = 24 * 3600
/** Debounce for the acting-user fast reconcile — lets a burst of actions coalesce. */
const FAST_RECONCILE_DELAY_MS = 3_000
/** Debounce for `counts:changed` pings per user. */
const PUBLISH_DEBOUNCE_MS = 2_000

const countsKey = (orgId: string, userId: string) => `mail:counts:${orgId}:${userId}`
const epochKey = (orgId: string) => `mail:counts:epoch:${orgId}`

/**
 * Hash fields: `inbox` (personal), `drafts`, `si:{inboxId}` (shared inbox),
 * `view:{viewId}`, plus `_reconciledAt` / `_epoch` metadata.
 */
export type MailCountField = 'inbox' | 'drafts' | `si:${string}` | `view:${string}`

export interface UserCountDeltas {
  userId: string
  deltas: Partial<Record<MailCountField, number>>
}

/**
 * Serve sidebar counts from the counter hash. Miss → full recount inline.
 * Stale (`_reconciledAt` too old or org epoch bumped) → serve cached values
 * immediately and enqueue a deduped background reconcile.
 */
export async function getMailCounts(orgId: string, userId: string): Promise<FullCountsResponse> {
  const hash = counterHash(countsKey(orgId, userId), TTL_SECONDS)
  const redis = await getRedisClient()
  const [cached, epochRaw] = await Promise.all([hash.readAll(), redis.get(epochKey(orgId))])

  if (!cached) {
    return computeAndSeedMailCounts(orgId, userId)
  }

  const currentEpoch = Number(epochRaw ?? 0)
  const stale =
    Date.now() - (cached._reconciledAt ?? 0) > RECONCILE_INTERVAL_MS ||
    (cached._epoch ?? 0) !== currentEpoch
  if (stale) {
    void enqueueMailCountsReconcile(orgId, userId)
  }

  return toResponse(cached)
}

/**
 * Full recount from Postgres (the old live queries), then overwrite the hash.
 * Used inline on cache miss and by the worker reconcile job.
 */
export async function computeAndSeedMailCounts(
  orgId: string,
  userId: string
): Promise<FullCountsResponse> {
  // Counts run as the target user's viewer (§10.1) — the one documented
  // worker exception to SYSTEM_VISIBILITY: a badge is a per-user artifact.
  const { getOrgCache, getCachedUserInstanceGrants } = await import('../cache')
  const viewer = await getCachedUserInstanceGrants(userId, orgId)
  const unreadService = new UnreadService(orgId, userId, viewer)
  const redis = await getRedisClient()

  const [inboxes, viewIds, epochRaw] = await Promise.all([
    getOrgCache().get(orgId, 'inboxes'),
    unreadService.getAccessibleViewIds(),
    redis.get(epochKey(orgId)),
  ])

  // Unread state is `full`-tier: only inboxes the user sees at `full` carry a
  // badge. One rule for everyone since plan 40 §4.2 — the `viewer.isAdmin ?
  // !personalInboxIds[id]` arm is gone because the composed floor now answers it:
  // a default admin is `full` on every shared inbox through the area fallback and
  // `metadata` (never `full`) on others' personal mailboxes, so this filter
  // returns the identical set for them, and the correct — smaller — one for an
  // admin whose profile was downgraded.
  const countableInboxes = inboxes.filter((ib) => viewer.inboxLens[ib.id] === 'read')

  const [inbox, drafts, views, perInbox] = await Promise.all([
    unreadService.getPersonalInboxCount(),
    unreadService.getDraftsCount(),
    unreadService.getViewCounts(viewIds),
    Promise.all(
      countableInboxes.map(
        async (ib) => [ib.id, await unreadService.calculateUnreadCountForUserInbox(ib.id)] as const
      )
    ),
  ])

  const sharedInboxes: Record<string, number> = Object.fromEntries(perInbox)
  const fields: Record<string, number> = {
    inbox,
    drafts,
    _reconciledAt: Date.now(),
    _epoch: Number(epochRaw ?? 0),
  }
  for (const [inboxId, unread] of perInbox) fields[`si:${inboxId}`] = unread
  for (const [viewId, unread] of Object.entries(views)) fields[`view:${viewId}`] = unread

  // Redis being down must not fail the read — we already have the values.
  await counterHash(countsKey(orgId, userId), TTL_SECONDS)
    .seed(fields)
    .catch((error) =>
      logger.warn('Failed to seed mail counts', { orgId, userId, error: (error as Error).message })
    )

  return { inbox, drafts, sharedInboxes, views }
}

/**
 * Apply per-user counter deltas (merged per user, one pipeline each) and
 * schedule a debounced `counts:changed` ping. Never throws — a failed delta is
 * bounded drift that reconciliation heals.
 *
 * Pass `fastReconcileUserId` for interactive mutations: view badges receive no
 * server deltas, so the acting user gets a prompt full recount to keep their
 * optimistically-updated numbers from bouncing back.
 */
export async function applyMailCountDeltas(
  orgId: string,
  userDeltas: UserCountDeltas[],
  options?: { fastReconcileUserId?: string }
): Promise<void> {
  try {
    const merged = new Map<string, Record<string, number>>()
    for (const { userId, deltas } of userDeltas) {
      const acc = merged.get(userId) ?? {}
      for (const [field, delta] of Object.entries(deltas)) {
        if (delta) acc[field] = (acc[field] ?? 0) + delta
      }
      merged.set(userId, acc)
    }

    await Promise.all(
      [...merged].map(async ([userId, deltas]) => {
        await counterHash(countsKey(orgId, userId), TTL_SECONDS).applyDeltas(deltas)
        schedulePublishCountsChanged(orgId, userId)
      })
    )

    if (options?.fastReconcileUserId) {
      await enqueueMailCountsReconcile(orgId, options.fastReconcileUserId, FAST_RECONCILE_DELAY_MS)
    }
  } catch (error) {
    logger.warn('Failed to apply mail count deltas', { orgId, error: (error as Error).message })
  }
}

/**
 * Slow path for bulk/rare operations: drop the staleness marker and enqueue a
 * recount per user instead of computing per-thread delta math.
 */
export async function markMailCountsStale(orgId: string, userIds: string[]): Promise<void> {
  await Promise.allSettled(
    userIds.map(async (userId) => {
      await counterHash(countsKey(orgId, userId), TTL_SECONDS).removeFields('_reconciledAt')
      await enqueueMailCountsReconcile(orgId, userId, FAST_RECONCILE_DELAY_MS)
    })
  )
}

/**
 * Slow path for whole-inbox events (sync completed): mark every org member's
 * counts stale. Member list comes from the org cache — no DB hit.
 */
export async function markMailCountsStaleForOrgMembers(orgId: string): Promise<void> {
  try {
    const { getCachedMembers } = await import('../cache')
    const members = await getCachedMembers(orgId)
    await markMailCountsStale(
      orgId,
      members.map((m) => m.userId)
    )
  } catch (error) {
    logger.warn('Failed to mark org mail counts stale', {
      orgId,
      error: (error as Error).message,
    })
  }
}

/**
 * Org-wide invalidation without key scans (view/inbox changed, channel
 * disconnected): bump the epoch; every user's hash reconciles lazily on their
 * next read.
 */
export async function bumpMailCountsEpoch(orgId: string): Promise<void> {
  try {
    const redis = await getRedisClient()
    await redis.incr(epochKey(orgId))
  } catch (error) {
    logger.warn('Failed to bump mail counts epoch', { orgId, error: (error as Error).message })
  }
}

/**
 * Enqueue the worker recount for one user. Deduped via jobId so a burst of
 * stale reads or actions collapses into a single job.
 */
export async function enqueueMailCountsReconcile(
  orgId: string,
  userId: string,
  delayMs = 0
): Promise<void> {
  try {
    const [{ getQueue }, { Queues }] = await Promise.all([
      import('../jobs/queues'),
      import('../jobs/queues/types'),
    ])
    await getQueue(Queues.maintenanceQueue).add(
      'mailCountsReconcile',
      { organizationId: orgId, userId },
      {
        jobId: `mail-counts-reconcile:${orgId}:${userId}`,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: true,
      }
    )
  } catch (error) {
    logger.warn('Failed to enqueue mail counts reconcile', {
      orgId,
      userId,
      error: (error as Error).message,
    })
  }
}

// ── internals ──

const publishTimers = new Map<string, NodeJS.Timeout>()

/** Debounced `counts:changed` ping on the user's room; a burst → one ping. */
function schedulePublishCountsChanged(orgId: string, userId: string) {
  const timerKey = `${orgId}:${userId}`
  if (publishTimers.has(timerKey)) return
  const timer = setTimeout(() => {
    publishTimers.delete(timerKey)
    void (async () => {
      // Lazy import: the realtime barrel must not be statically imported here
      // (breaks vi.mock in consumers' tests).
      const { getRealtimeService, publishCountsChanged } = await import('../realtime')
      await publishCountsChanged(getRealtimeService(), userId)
    })().catch((error) =>
      logger.warn('Failed to publish counts:changed', {
        userId,
        error: (error as Error).message,
      })
    )
  }, PUBLISH_DEBOUNCE_MS)
  timer.unref?.()
  publishTimers.set(timerKey, timer)
}

/** Unpack hash fields into the API response shape, clamping drift below zero. */
function toResponse(fields: Record<string, number>): FullCountsResponse {
  const sharedInboxes: Record<string, number> = {}
  const views: Record<string, number> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (field.startsWith('si:')) sharedInboxes[field.slice(3)] = Math.max(0, value)
    else if (field.startsWith('view:')) views[field.slice(5)] = Math.max(0, value)
  }
  return {
    inbox: Math.max(0, fields.inbox ?? 0),
    drafts: Math.max(0, fields.drafts ?? 0),
    sharedInboxes,
    views,
  }
}
