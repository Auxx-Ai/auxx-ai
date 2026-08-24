// packages/lib/src/files/upload/post-commit.ts

/**
 * Everything an upload does **after** its transaction has committed.
 *
 * ## Why this is still a function rather than only `handler.afterCommit`
 *
 * PR 4e left this file as an explicit intermediate and asked 4d to decide
 * whether `afterCommit` should absorb it. It absorbed the *entity-specific*
 * half and none of the rest, and the split is deliberate:
 *
 * - What used to be here as `EntityType`-keyed tables and
 *   `if (session.entityType === 'USER_PROFILE')` branches is now handler data —
 *   `handler.thumbnails` and `handler.afterCommit`. A transport-adjacent module
 *   no longer knows what an avatar is or which cache an agent's picture lives in.
 * - What stays is everything that is a property of the **pipeline**, not of any
 *   one entity: that this runs strictly after `COMMIT`, that nothing in it may
 *   fail the request, and that the response gets a preview URL. A hook a handler
 *   could invoke from anywhere would lose both guarantees — an `afterCommit`
 *   called from an `onPersist` is back inside the transaction, and an
 *   `afterCommit` that has to remember its own `try/catch` will eventually
 *   forget.
 *
 * So: one caller, one guard, one ordering rule, and per-entity knowledge on the
 * per-entity record.
 *
 * ## The ordering rule this file exists to obey
 *
 * Nothing here may run inside the transaction (`plans/attachments/06` §6.1, and
 * Tier-1 §1.3). The thumbnail enqueue resolves its source asset on its *own*
 * connection: enqueued before `COMMIT`, it reads the pre-transaction
 * `currentVersionId`, answers `ready` against the previous version, and a
 * re-uploaded avatar keeps serving the old image forever. The four avatar
 * presets used to be enqueued by the entity processor, which ran inside the
 * route's still-open transaction, and that is exactly the bug that produced.
 *
 * So {@link runUploadPostCommit} is called by `completeUpload` *after*
 * `db.transaction` has resolved, and it is the only place an upload enqueues a
 * thumbnail or busts a cache.
 *
 * ## Nothing here may fail the request
 *
 * By the time this runs the bytes are in S3 and the rows are committed. A
 * dehydration bust that throws must not turn a durable upload into a 500 that
 * also marks the session `failed` — which is what happened before, because the
 * two cache calls sat unguarded in the route's outer `try`. Every step is
 * best-effort and logged; the caller gets whatever succeeded.
 */

import { createScopedLogger } from '@auxx/logger'
import { getAssetDownloadRef } from '../assets/download'
import type { FilesCtx, FilesDeps } from '../ctx'
import type { PresetKey } from '../thumbnails/presets'
import { ensureThumbnailPresets } from '../thumbnails/thumbnail-mutations'
import type { PersistResult, UploadHandler } from './handlers/types'
import type { PresignedUploadSession } from './session-types'

const logger = createScopedLogger('upload-post-commit')

/** Storage to presign a preview URL, queue to enqueue thumbnails, clock for the job payload. */
export type UploadPostCommitDeps = Pick<FilesDeps, 'storage' | 'queue' | 'now'>

/** What post-commit work has to say for itself. */
export interface UploadPostCommitResult {
  /** A URL the client can preview the upload with, when one could be resolved. */
  url?: string
}

/**
 * Run every after-COMMIT side effect this upload's handler asks for.
 *
 * @param ctx Scope. `ctx.db` must be the pool, **not** the transaction that just
 *   committed — a committed transaction object is spent, and the whole point of
 *   this step is that it observes the committed state.
 * @param deps Storage, queue and clock — see {@link UploadPostCommitDeps}.
 * @param handler The entity type's handler, source of both hooks below.
 * @param session The finished upload session.
 * @param result What the persistence step created.
 */
export async function runUploadPostCommit(
  ctx: FilesCtx,
  deps: UploadPostCommitDeps,
  handler: UploadHandler,
  session: PresignedUploadSession,
  result: PersistResult
): Promise<UploadPostCommitResult> {
  await runHandlerAfterCommit(ctx, deps, handler, session, result)
  const thumbnails = await enqueueThumbnails(ctx, deps, handler, session, result)
  const url = await resolvePreviewUrl(ctx, deps, handler, result, thumbnails)
  return { ...(url ? { url } : {}) }
}

/**
 * The handler's own post-commit work: cache busts, queue writes, anything that
 * resolves its source on a different connection.
 *
 * Wrapped here rather than inside each hook so "a failure must not fail the
 * request" is a property of the pipeline. A hook that wants finer granularity —
 * `USER_PROFILE` guards its two busts separately, because they invalidate
 * different readers — still can, and this is the backstop under it.
 */
async function runHandlerAfterCommit(
  ctx: FilesCtx,
  deps: UploadPostCommitDeps,
  handler: UploadHandler,
  session: PresignedUploadSession,
  result: PersistResult
): Promise<void> {
  if (!handler.afterCommit) return

  try {
    await handler.afterCommit(ctx, deps, result, session)
  } catch (error) {
    logger.error('Post-commit work failed for a completed upload', {
      sessionId: session.id,
      entityType: session.entityType,
      error,
    })
  }
}

/**
 * Enqueue the handler's derived thumbnails, if it declares any.
 *
 * One `ensureThumbnailPresets` call rather than a loop over `ensureThumbnail`:
 * the source asset is resolved once for the whole fan-out instead of once per
 * preset, which is four database round-trips saved on every avatar upload.
 *
 * A derived image must never fail an upload whose bytes and rows are already
 * durable, so a failure here is logged and the set comes back empty.
 */
async function enqueueThumbnails(
  ctx: FilesCtx,
  deps: UploadPostCommitDeps,
  handler: UploadHandler,
  session: PresignedUploadSession,
  result: PersistResult
): Promise<Map<PresetKey, { status: string; assetId?: string }>> {
  const enqueued = new Map<PresetKey, { status: string; assetId?: string }>()

  const spec = handler.thumbnails
  if (!spec || spec.presets.length === 0 || !result.assetId) return enqueued

  const presets = await ensureThumbnailPresets(
    ctx,
    { queue: deps.queue, now: deps.now },
    {
      source: { type: 'asset', assetId: result.assetId },
      createdById: session.userId,
      presets: spec.presets,
      defaultOptions: { visibility: 'PUBLIC' },
      perPreset: spec.perPreset,
    }
  )

  if (presets.isErr()) {
    logger.error('Failed to enqueue derived thumbnails for a completed upload', {
      sessionId: session.id,
      assetId: result.assetId,
      presets: spec.presets,
      error: presets.error,
    })
    return enqueued
  }

  for (const preset of presets.value) {
    enqueued.set(preset.preset, { status: preset.status, assetId: preset.assetId })
  }
  return enqueued
}

/**
 * The URL the client previews the upload with.
 *
 * Prefers the handler's declared `preview` preset when the fan-out above found
 * it already generated — there is no job to wait on in that case — and otherwise
 * the original, which is what the client shows until the preset lands.
 */
async function resolvePreviewUrl(
  ctx: FilesCtx,
  deps: UploadPostCommitDeps,
  handler: UploadHandler,
  result: PersistResult,
  thumbnails: Map<PresetKey, { status: string; assetId?: string }>
): Promise<string | undefined> {
  if (!result.assetId) return undefined

  const preferred = handler.thumbnails?.preview
  const preview = preferred ? thumbnails.get(preferred) : undefined
  const assetId = preview?.status === 'ready' && preview.assetId ? preview.assetId : result.assetId

  const ref = await getAssetDownloadRef(ctx, { storage: deps.storage }, assetId)
  if (ref.isErr()) {
    logger.warn('Failed to resolve a preview URL for a completed upload', {
      assetId,
      error: ref.error,
    })
    return undefined
  }

  return ref.value.type === 'url' ? ref.value.url : undefined
}
