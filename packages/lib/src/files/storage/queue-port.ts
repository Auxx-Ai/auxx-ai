// packages/lib/src/files/storage/queue-port.ts

/**
 * The production {@link QueuePort} — the implementation Phase 2 deliberately did
 * not write.
 *
 * `storage/ports.ts` shipped `QueuePort` as an interface with no production
 * implementation on purpose: the two enqueue sites that existed disagreed, and
 * picking between them is policy, not plumbing
 * (`plans/attachments/05-core-services.md` §5.6.1). This file is that decision.
 *
 * It lives beside `ports.ts` rather than inside it because it imports
 * `jobs/queues`, and therefore BullMQ. `ports.ts` is reached by `files/ctx.ts`
 * and by every read path that only wants a `StoragePort`; pulling a queue client
 * into that graph to presign a URL is the cost `FilesDepsSlice` exists to avoid.
 *
 * ## The thumbnail enqueue policy, and why this one won
 *
 * Two shapes were in the tree:
 *
 * | | `core/thumbnail-enqueue.ts` | `core/thumbnail-service.ts` |
 * | --- | --- | --- |
 * | job id | auto (random) | deterministic `thumb-${key}` |
 * | dedup | none | job id + Redis latch |
 * | retries | none | `attempts: 3`, exponential from 2s |
 * | retention | `removeOnComplete: true` | default (unbounded) |
 *
 * The service's shape is kept, for three reasons that are checkable rather than
 * aesthetic:
 *
 * 1. **The worker was already written against it.**
 *    `generate-thumbnail-job.ts` deletes `processing:thumb-${key}` on both its
 *    success and failure paths. Jobs enqueued the other way never wrote that key,
 *    so the release was a no-op and the dedup half of the design was simply
 *    absent for that producer.
 * 2. **The fan-out is real.** `complete/route.ts` enqueues four avatar presets
 *    per upload, and a retried completion — which the route explicitly supports —
 *    enqueued four more with random ids. A deterministic id makes the retry free.
 * 3. **The work is retryable and the failure mode is transient.** Generation
 *    downloads from S3 and runs sharp. `removeOnComplete: true` with no
 *    `attempts` means one S3 blip permanently loses an avatar preset, and the
 *    only thing that would ever notice is a user looking at a broken image.
 *
 * `removeOnComplete: true` is *not* kept as-is: it discards the job record
 * immediately, which is exactly what you want gone when you are debugging why a
 * preset never appeared. Bounded retention (`{ count: … }`) keeps a short tail
 * without letting the queue grow forever, matching what
 * `enqueueOrphanedStorageObjectCleanup` already does on the maintenance queue.
 *
 * ## `enqueueStorageCleanup` returns a job id and does not swallow
 *
 * The other half of §5.6.1: `enqueueOrphanedStorageObjectCleanup` returns
 * `Promise<void>` and logs-and-drops an enqueue failure, while
 * `QueuePort.enqueueStorageCleanup` promises `Promise<string>`. **The port wins.**
 *
 * Swallowing is a *call-site* policy — "compensation must never turn a failed
 * upload into a failed request" is a statement about the upload route, not about
 * queues. Burying the `try/catch` in the port makes every future caller inherit
 * fail-open behaviour it never asked for and cannot opt out of, and it throws
 * away the job id that is the port's whole reason for returning one (a test can
 * assert *which* job was scheduled without a queue running).
 *
 * So the port throws, and `enqueueOrphanedStorageObjectCleanup` keeps its
 * `Promise<void>` fail-open signature — but is now a thin, explicitly-named
 * wrapper *over this port* rather than a second copy of the job options. One
 * enqueue, one set of options, and exactly one place where the swallow happens,
 * with a comment saying why.
 */

import { getRedisClient } from '@auxx/redis'
import { AuxxError } from '../../errors'
import { getQueue } from '../../jobs/queues'
// `Queues` comes from the leaf module rather than the barrel: several job tests
// replace `jobs/queues` wholesale with a `{ getQueue }`-only factory, and Vitest
// validates named bindings at link time, so a `Queues` import from the barrel
// would make this module unloadable inside them.
import { Queues } from '../../jobs/queues/types'
import { thumbnailJobId } from '../thumbnails/presets'
import {
  acquireThumbnailLatch,
  holdThumbnailLatch,
  THUMBNAIL_JOB_NAME,
} from '../thumbnails/thumbnail-job'
import type { EnqueueStorageCleanupParams, EnqueueThumbnailParams, QueuePort } from './ports'

/** Retries for work that fails on transient S3/network problems. */
const THUMBNAIL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  /**
   * Bounded rather than `true`: a completed job record is what you read to find
   * out why a preset never appeared, and `removeOnComplete: true` deletes it
   * before anyone can look.
   */
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
} as const

/** Compensation deletes are worth retrying hard — a missed one leaks an object forever. */
const STORAGE_CLEANUP_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
  priority: 10,
} as const

/**
 * Build the production {@link QueuePort}.
 *
 * Both methods return the enqueued job id and throw on failure. A caller that
 * wants an enqueue failure to be non-fatal catches it *at the call site*, where
 * the decision is visible.
 */
export function createProductionQueuePort(): QueuePort {
  return {
    enqueueThumbnail,
    enqueueStorageCleanup,
  }
}

/**
 * Enqueue one thumbnail render, deduplicated two ways.
 *
 * The Redis latch is checked first and short-circuits with the id already
 * holding it, so a burst of identical requests costs one queue write. The
 * deterministic job id covers the same key while the job is waiting or active;
 * the latch covers the gap after completion, before the row is visible to a
 * concurrent reader.
 *
 * Redis is **required**, matching the legacy service: a thumbnail enqueue with
 * no latch is the un-deduplicated behaviour this policy exists to end, so
 * failing loudly beats silently degrading to it.
 *
 * @throws {AuxxError} when Redis is unavailable.
 */
async function enqueueThumbnail(p: EnqueueThumbnailParams): Promise<string> {
  const redis = await getRedisClient(false)
  if (!redis) {
    throw new AuxxError('Redis is required to enqueue thumbnail jobs but is unavailable')
  }

  const held = await acquireThumbnailLatch(redis, p.key)
  if (held) return held

  const job = await getQueue(Queues.thumbnailQueue).add(THUMBNAIL_JOB_NAME, p, {
    jobId: thumbnailJobId(p.key),
    ...THUMBNAIL_JOB_OPTIONS,
  })

  const jobId = job.id
  if (!jobId) throw new AuxxError('Thumbnail queue returned a job with no id')

  await holdThumbnailLatch(redis, p.key, jobId)
  return jobId
}

/**
 * Enqueue one orphaned-object delete on the maintenance queue.
 *
 * Keyed on bucket + key, because the same object arriving from a retried
 * completion is the same unit of work. `bucket` is required on
 * {@link EnqueueStorageCleanupParams} even though the job accepts it optionally
 * — a delete aimed at the wrong bucket 204s and the object leaks (#1816).
 *
 * Throws. See the file header for why the swallow lives at the call site.
 */
async function enqueueStorageCleanup(p: EnqueueStorageCleanupParams): Promise<string> {
  const job = await getQueue(Queues.maintenanceQueue).add('orphanedStorageObjectJob', p, {
    jobId: `orphaned-storage-object:${p.bucket}:${p.key}`,
    ...STORAGE_CLEANUP_JOB_OPTIONS,
  })

  const jobId = job.id
  if (!jobId) throw new AuxxError('Maintenance queue returned a job with no id')
  return jobId
}
