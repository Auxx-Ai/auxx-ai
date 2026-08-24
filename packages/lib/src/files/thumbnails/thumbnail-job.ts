// packages/lib/src/files/thumbnails/thumbnail-job.ts

/**
 * The `generateThumbnail` job contract — everything the producer and the worker
 * must agree on, in one place.
 *
 * ## What this file is, and what it is not
 *
 * `plans/attachments/05-core-services.md` §5.7 asks for "the BullMQ handler"
 * here. The handler stayed in `jobs/maintenance/generate-thumbnail-job.ts`, and
 * that is a deliberate deviation: it is 455 lines that reach `MediaAssetService`,
 * `field-values/avatar-thumbnail` and `field-values`' realtime publish, so
 * relocating it either drags `field-values` into `files/` — a lateral import for
 * no gain — or turns 5f into the `MediaAssetService.createWithVersion` rewrite
 * that PR 5a explicitly left for later. Moving 455 lines without converting them
 * relocates the problem; converting them is its own PR.
 *
 * What *did* need a home is the part the two sides were duplicating and getting
 * wrong. The worker released its enqueue latch at a hard-coded
 * `processing:thumb-${key}`, the service wrote it at a string built the same way
 * by coincidence, and `thumbnail-enqueue.ts` wrote no latch at all under a
 * differently-shaped key. Three copies of one convention, two of which agreed.
 * The derivation now lives in `presets.ts`, and the two Redis operations live
 * here, so producer and consumer cannot drift again.
 */

import type { RedisClient } from '@auxx/redis'
import { z } from 'zod'
import { thumbnailLatchKey } from './presets'

/** The queue job name. Pinned here so a typo at either end is a compile error. */
export const THUMBNAIL_JOB_NAME = 'generateThumbnail'

/** How long a latch survives without being released, in seconds. */
export const THUMBNAIL_LATCH_TTL_SEC = 60

/**
 * The Redis surface the latch needs, and nothing more.
 *
 * Same reasoning as `UploadSessionRedis` in `upload/session.ts`: a full
 * `RedisClient` in a signature forces a test to stub ~200 members or reach for an
 * `as unknown as RedisClient` cast. A real client satisfies this structurally, so
 * production callers are unaffected and `makeRedis()` from the support kit drops
 * straight in.
 */
export type ThumbnailLatchRedis = Pick<RedisClient, 'get' | 'setex' | 'del'>

/**
 * Validation for the persisted job payload.
 *
 * Moved off `jobs/maintenance/generate-thumbnail-job.ts` so the schema sits with
 * the type it validates. `opts` stays permissive — a job enqueued by an older
 * deploy is still in Redis when a new one starts consuming, so a field this build
 * has stopped writing must not fail the parse.
 */
export const generateThumbnailSchema = z.object({
  orgId: z.string(),
  userId: z.string(),
  versionId: z.string(),
  preset: z.string(),
  opts: z.object({
    preset: z.string().optional(),
    queue: z.boolean().optional(),
    format: z.enum(['webp', 'jpeg', 'png']).optional(),
    quality: z.number().optional(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    updateUser: z.boolean().optional(),
  }),
  key: z.string(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
})

/**
 * Take the thundering-herd latch for a thumbnail key, or report who already has it.
 *
 * BullMQ's deterministic job id covers the window while a job is waiting or
 * active. It does **not** cover the moment after completion, when the id is
 * released but the database row may not be visible to a concurrent reader yet —
 * and an avatar upload fans four presets out at once while a record page can ask
 * for the same preset from several components in the same tick. This latch is
 * that second window.
 *
 * @returns the existing job id when the latch is already held, otherwise `null`
 *   — meaning the caller owns it and should enqueue.
 */
export async function acquireThumbnailLatch(
  redis: ThumbnailLatchRedis,
  key: string
): Promise<string | null> {
  return redis.get(thumbnailLatchKey(key))
}

/**
 * Record the job id that owns a thumbnail key's latch.
 *
 * Called after a successful enqueue. The TTL is the backstop for a worker that
 * dies without releasing: the latch evaporates and the next request re-enqueues.
 */
export async function holdThumbnailLatch(
  redis: ThumbnailLatchRedis,
  key: string,
  jobId: string
): Promise<void> {
  await redis.setex(thumbnailLatchKey(key), THUMBNAIL_LATCH_TTL_SEC, jobId)
}

/**
 * Release a thumbnail key's latch.
 *
 * The worker calls this on **both** its success and failure paths — a failure
 * that held the latch for the full TTL would delay the retry that BullMQ has
 * already scheduled.
 */
export async function releaseThumbnailLatch(
  redis: ThumbnailLatchRedis,
  key: string
): Promise<void> {
  await redis.del(thumbnailLatchKey(key))
}
