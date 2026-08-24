// packages/lib/src/files/upload/post-commit.ts

/**
 * Everything an upload does **after** its transaction has committed.
 *
 * ## Why this is a file rather than four `if`s in a route
 *
 * `complete/route.ts` carried a `POST_COMMIT_THUMBNAIL_PRESETS` table, two
 * `session.entityType === 'USER_PROFILE'` branches, and a download-URL lookup
 * that preferred `avatar-32`. A transport handler knew what an avatar was, which
 * preset writes `User.image`, and which cache an agent's picture lives in.
 *
 * Plan §4.7 puts that knowledge on the handler record (`afterCommit`). That hook
 * does not exist yet — `handlers/types.ts` says in as many words that PR 4d adds
 * it, together with the `PersistResult` it carries — so this module is the
 * intermediate home: the same table, keyed by the same `EntityType`, called from
 * one place. **PR 4d folds it into `handler.afterCommit` and deletes this file.**
 *
 * ## The ordering rule this file exists to obey
 *
 * Nothing here may run inside the transaction (`plans/attachments/06` §6.1, and
 * Tier-1 §1.3). The thumbnail enqueue resolves its source asset on its *own*
 * connection: enqueued before `COMMIT`, it reads the pre-transaction
 * `currentVersionId`, answers `ready` against the previous version, and a
 * re-uploaded avatar keeps serving the old image forever. The four avatar
 * presets used to be enqueued by the entity processor, which runs inside the
 * route's still-open transaction, and that is exactly the bug that produced.
 *
 * So {@link runUploadPostCommit} is called by `completeUpload` *after*
 * `db.transaction` has resolved, and it is the only place an upload enqueues a
 * thumbnail.
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
import type { EntityType } from '../types/entities'
import type { PresignedUploadSession } from './session-types'

const logger = createScopedLogger('upload-post-commit')

/**
 * Derived thumbnails to enqueue once the upload transaction has COMMITTED.
 *
 * Keyed by `EntityType`. An entity absent from the table enqueues nothing, which
 * is the correct answer for every attachment-shaped upload — a mail attachment
 * has no derived rendition anyone waits on.
 */
const POST_COMMIT_THUMBNAIL_PRESETS: Partial<Record<EntityType, readonly PresetKey[]>> = {
  USER_PROFILE: ['avatar-32', 'avatar-64', 'avatar-128', 'avatar-256'],
  KNOWLEDGE_BASE: ['kb-logo-sm', 'kb-logo-lg'],
}

/**
 * The preset whose completion writes `User.image`.
 *
 * Exactly one, and the worker honours it for `avatar-64` only — asking for it on
 * a second preset would mean two jobs racing to write one column.
 */
const AVATAR_USER_IMAGE_PRESET: PresetKey = 'avatar-64'

/** The tiny avatar the response prefers when it turns out to be already generated. */
const AVATAR_PREVIEW_PRESET: PresetKey = 'avatar-32'

/** Storage to presign a preview URL, queue to enqueue thumbnails, clock for the job payload. */
export type UploadPostCommitDeps = Pick<FilesDeps, 'storage' | 'queue' | 'now'>

/** The identifiers the persistence step produced, as much of them as it produced. */
export interface UploadPersistedRefs {
  assetId?: string
  fileId?: string
  attachmentId?: string
  documentId?: string
}

/** What post-commit work has to say for itself. */
export interface UploadPostCommitResult {
  /** A URL the client can preview the upload with, when one could be resolved. */
  url?: string
}

/**
 * Run every after-COMMIT side effect this upload's entity type asks for.
 *
 * @param ctx Scope. `ctx.db` must be the pool, **not** the transaction that just
 *   committed — a committed transaction object is spent, and the whole point of
 *   this step is that it observes the committed state.
 * @param deps Storage, queue and clock — see {@link UploadPostCommitDeps}.
 * @param session The finished upload session.
 * @param refs What the persistence step created.
 */
export async function runUploadPostCommit(
  ctx: FilesCtx,
  deps: UploadPostCommitDeps,
  session: PresignedUploadSession,
  refs: UploadPersistedRefs
): Promise<UploadPostCommitResult> {
  await invalidateCaches(session)
  const thumbnails = await enqueueThumbnails(ctx, deps, session, refs)
  const url = await resolvePreviewUrl(ctx, deps, refs, thumbnails)
  return { ...(url ? { url } : {}) }
}

/**
 * Cache invalidation for entity types whose upload changes a cached read.
 *
 * `USER_PROFILE` is the only one: the avatar is rendered from the dehydrated
 * user, and an admin uploading for an agent's synthetic user also changes the
 * org `agents` cache. Both are lazy imports — they are the cold path, and
 * `files/` reaching `cache/` or `dehydration/` at module scope is an import
 * cycle waiting to happen. PR 4d moves both behind ports.
 */
async function invalidateCaches(session: PresignedUploadSession): Promise<void> {
  if (session.entityType !== 'USER_PROFILE') return

  const targetUserId = session.entityId || session.userId

  try {
    const { DehydrationService } = await import('../../dehydration')
    await new DehydrationService().invalidateUser(targetUserId)
  } catch (error) {
    logger.error('Failed to invalidate the dehydrated user after an avatar upload', {
      sessionId: session.id,
      userId: targetUserId,
      error,
    })
  }

  // An admin uploading for an agent's synthetic user: bust the org `agents`
  // cache so the avatar URL refreshes on the next load. The processor's
  // `validateEntityAccess` is what guarantees a mismatched `entityId` is an
  // agent user rather than an arbitrary one.
  if (!session.entityId || session.entityId === session.userId) return

  try {
    const { onCacheEvent } = await import('../../cache')
    await onCacheEvent('agent.updated', { orgId: session.organizationId })
  } catch (error) {
    logger.error('Failed to bust the agents cache after an agent avatar upload', {
      sessionId: session.id,
      organizationId: session.organizationId,
      error,
    })
  }
}

/**
 * Enqueue the entity type's derived thumbnails, if it has any.
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
  session: PresignedUploadSession,
  refs: UploadPersistedRefs
): Promise<Map<PresetKey, { status: string; assetId?: string }>> {
  const enqueued = new Map<PresetKey, { status: string; assetId?: string }>()

  const presets = POST_COMMIT_THUMBNAIL_PRESETS[session.entityType] ?? []
  if (!refs.assetId || presets.length === 0) return enqueued

  const result = await ensureThumbnailPresets(
    ctx,
    { queue: deps.queue, now: deps.now },
    {
      source: { type: 'asset', assetId: refs.assetId },
      createdById: session.userId,
      presets,
      defaultOptions: { visibility: 'PUBLIC' },
      perPreset: { [AVATAR_USER_IMAGE_PRESET]: { updateUser: true } },
    }
  )

  if (result.isErr()) {
    logger.error('Failed to enqueue derived thumbnails for a completed upload', {
      sessionId: session.id,
      assetId: refs.assetId,
      presets,
      error: result.error,
    })
    return enqueued
  }

  for (const preset of result.value) {
    enqueued.set(preset.preset, { status: preset.status, assetId: preset.assetId })
  }
  return enqueued
}

/**
 * The URL the client previews the upload with.
 *
 * Prefers the tiny avatar when the fan-out above found it already generated —
 * there is no job to wait on in that case — and otherwise the original, which is
 * what the client shows until the preset lands.
 *
 * Replaces `new MediaAssetService(orgId, userId).getDownloadUrl(assetId)`, which
 * has delegated to {@link getAssetDownloadRef} internally since PR 5a; calling
 * the function directly drops the last service construction on this path and the
 * fabricated actor it needed.
 */
async function resolvePreviewUrl(
  ctx: FilesCtx,
  deps: UploadPostCommitDeps,
  refs: UploadPersistedRefs,
  thumbnails: Map<PresetKey, { status: string; assetId?: string }>
): Promise<string | undefined> {
  if (!refs.assetId) return undefined

  const preview = thumbnails.get(AVATAR_PREVIEW_PRESET)
  const assetId = preview?.status === 'ready' && preview.assetId ? preview.assetId : refs.assetId

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
