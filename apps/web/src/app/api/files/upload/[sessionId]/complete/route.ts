// apps/web/src/app/api/files/upload/[sessionId]/complete/route.ts

import { database as db } from '@auxx/database'
import {
  createStorageManager,
  ensureProcessorsInitialized,
  ProcessorRegistry,
  patchUploadSession,
  UploadErrorHandler,
  uploadSessionRedis,
} from '@auxx/lib/files/server'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeUploadSession } from '../authorize-upload-session'

const logger = createScopedLogger('api-upload-complete')

/** The clock `patchUploadSession` floors a nearly-dead session's TTL against. */
const now = () => new Date()

const CompletionSchema = z.object({
  storageKey: z.string().optional(), // ✅ Make optional since server knows the truth
  size: z.number().positive(),
  mimeType: z.string(),
  etag: z.string().optional(),
  uploadId: z.string().optional(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string(),
      })
    )
    .optional(),
})

interface RouteParams {
  params: Promise<{ sessionId: string }>
}

/**
 * Derived thumbnails to enqueue once the upload transaction has COMMITTED.
 *
 * These used to be enqueued by the entity processors, under a comment claiming
 * they ran after the commit. They did not — a processor runs inside the
 * transaction opened below, and the enqueue resolves its source asset on the
 * global `db`, a different connection that still sees the PRE-transaction
 * `currentVersionId`. A first upload therefore threw `Asset not found` and a
 * re-upload silently kept serving the previous image
 * (`docs/files-upload-architecture-guide.md` §10.3).
 */
const POST_COMMIT_THUMBNAIL_PRESETS = {
  USER_PROFILE: ['avatar-32', 'avatar-64', 'avatar-128', 'avatar-256'],
  KNOWLEDGE_BASE: ['kb-logo-sm', 'kb-logo-lg'],
} as const

type ThumbnailPreset =
  (typeof POST_COMMIT_THUMBNAIL_PRESETS)[keyof typeof POST_COMMIT_THUMBNAIL_PRESETS][number]

/** `updateUser` writes `User.image` when the preset lands — avatar-64 only. */
const AVATAR_USER_IMAGE_PRESET: ThumbnailPreset = 'avatar-64'

/** The tiny avatar the response payload prefers when it is already generated. */
const AVATAR_PREVIEW_PRESET: ThumbnailPreset = 'avatar-32'

function postCommitPresetsFor(entityType: string): readonly ThumbnailPreset[] {
  const table = POST_COMMIT_THUMBNAIL_PRESETS as Record<
    string,
    readonly ThumbnailPreset[] | undefined
  >
  return table[entityType] ?? []
}

/**
 * Complete presigned upload and trigger processing
 * Implements three-phase approach: S3 operations -> DB transaction -> post-commit actions
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params

  try {
    // Authenticate FIRST: the session nanoid used to be the only credential on
    // this endpoint, so anyone holding one could complete someone else's upload
    // (`docs/files-upload-architecture-guide.md` §11.4). This also re-evaluates
    // authorization at completion time, which session-create alone never does.
    const authorized = await authorizeUploadSession(sessionId)
    if (authorized instanceof Response) return authorized
    const { session } = authorized

    const completion = CompletionSchema.parse(await request.json())

    if (!['created', 'uploading'].includes(session.status)) {
      return UploadErrorHandler.validationError('Invalid session status for completion', {
        currentStatus: session.status,
        expectedStatus: ['created', 'uploading'],
      })
    }

    const redis = await uploadSessionRedis()
    const storageManager = createStorageManager(session.organizationId)

    // ============= PHASE 1: S3 OPERATIONS (OUTSIDE TRANSACTION) =============

    // 1.1 Complete multipart upload if applicable
    if (session.isMultipart) {
      if (!completion.uploadId || !completion.parts) {
        return NextResponse.json(
          { error: 'Missing uploadId or parts for multipart upload' },
          { status: 400 }
        )
      }

      try {
        await storageManager.completeMultipartUploadOnly({
          provider: session.provider,
          key: session.storageKey,
          uploadId: completion.uploadId,
          parts: completion.parts,
          credentialId: session.credentialId,
          bucket: session.bucket,
        })
      } catch (err) {
        logger.error('Multipart completion failed', { sessionId, error: String(err) })
        await patchUploadSession(redis, sessionId, { status: 'failed' }, now)
        return NextResponse.json({ error: 'Failed to complete multipart upload' }, { status: 500 })
      }
    }

    // 1.2 HEAD request for file verification
    let headResult
    try {
      headResult = await storageManager.headByKey({
        provider: session.provider,
        key: session.storageKey,
        credentialId: session.credentialId,
        bucket: session.bucket,
      })
    } catch (err) {
      logger.error('File verification failed', { sessionId, error: String(err) })
      await patchUploadSession(redis, sessionId, { status: 'failed' }, now)
      return NextResponse.json({ error: 'Upload verification failed' }, { status: 404 })
    }

    // 1.3 Processor validation (pure checks, no side effects)
    ensureProcessorsInitialized()
    const processor = ProcessorRegistry.getForEntityType(session.entityType, session.organizationId)
    try {
      await processor.validateCompletedUpload(session, {
        size: headResult.size,
        mimeType: headResult.mimeType,
      })
    } catch (err) {
      logger.error('Upload validation failed', { sessionId, error: String(err) })
      await patchUploadSession(redis, sessionId, { status: 'failed' }, now)
      return NextResponse.json({ error: 'Upload validation failed' }, { status: 400 })
    }

    // 1.4 Update session with canonical values (best-effort, outside transaction)
    await patchUploadSession(
      redis,
      sessionId,
      { expectedSize: headResult.size, mimeType: headResult.mimeType || session.mimeType },
      now
    )

    // ============= PHASE 2: SINGLE DB TRANSACTION =============

    let result: any
    let storageLocationId: string

    try {
      // The transaction returns the StorageLocation id so it is definitely assigned
      // on the success path (the catch below returns, so nothing reads it on failure).
      storageLocationId = await db.transaction(async (tx) => {
        // 2.1 Build external URL for public assets (avatars, KB logos, etc.)
        let externalUrl = ''
        try {
          if (session.visibility === 'PUBLIC') {
            // Synchronous since PR 3b: this runs inside the open transaction,
            // and the async version could reach the credential store from here
            // just to learn a bucket the session already carries.
            externalUrl = storageManager.buildExternalUrl(session.provider, session.storageKey, {
              bucket: session.bucket,
              visibility: session.visibility,
            })
          }
        } catch (urlErr) {
          logger.warn('Failed to build external URL', {
            sessionId,
            storageKey: session.storageKey,
            error: String(urlErr),
          })
        }

        // 2.2 Create/Upsert StorageLocation
        const storageLocation = await storageManager.createStorageLocation(
          {
            provider: session.provider,
            externalId: session.storageKey,
            externalUrl, // Now populated for public assets
            externalRev: headResult.etagOrRev,
            size: headResult.size,
            mimeType: headResult.mimeType || session.mimeType,
            metadata: {
              sessionId,
              uploader: session.userId,
              originalFileName: session.fileName,
              originalEtag: completion.etag,
              originalSize: completion.size,
            },
            credentialId: session.credentialId,
            bucket: session.bucket,
            visibility: session.visibility,
          },
          { tx }
        )

        // 2.3 Let processor create Asset/File/Attachment with same TX
        result = await processor.process(session, storageLocation.id, { tx })

        // 2.4 Optionally persist domain outbox event
        // await tx.outboxEvent.create({ ... })

        return storageLocation.id
      })
    } catch (err) {
      // ============= COMPENSATION: S3 CLEANUP =============
      try {
        await storageManager.deleteByKey({
          provider: session.provider,
          key: session.storageKey,
          credentialId: session.credentialId,
          // Without this a PUBLIC upload's compensation deletes a nonexistent
          // key from the PRIVATE bucket, S3 answers 204, and the real object
          // leaks with no error and no log (guide §10.4).
          bucket: session.bucket,
        })
      } catch (cleanupErr) {
        logger.warn('Immediate S3 cleanup failed; scheduling for background cleanup', {
          key: session.storageKey,
          cleanupErr: String(cleanupErr),
        })

        // Durable retry on the maintenance queue. Lazy — this is the cold path.
        const { enqueueOrphanedStorageObjectCleanup } = await import('@auxx/lib/jobs')
        await enqueueOrphanedStorageObjectCleanup({
          provider: session.provider,
          key: session.storageKey,
          bucket: session.bucket,
          credentialId: session.credentialId,
          reason: `DB transaction failed: ${String(err)}`,
          organizationId: session.organizationId,
        })
      }

      await patchUploadSession(redis, sessionId, { status: 'failed' }, now)
      return NextResponse.json({ error: 'File processing failed' }, { status: 500 })
    }

    // ============= PHASE 3: POST-COMMIT ACTIONS =============

    // 3.1 Update session status
    await patchUploadSession(redis, sessionId, { status: 'completed', storageLocationId }, now)

    // 3.2 Invalidate caches so next page load fetches fresh data
    if (session.entityType === 'USER_PROFILE') {
      const targetUserId = session.entityId || session.userId
      const { DehydrationService } = await import('@auxx/lib/dehydration')
      await new DehydrationService().invalidateUser(targetUserId)

      // Agent avatar (admin uploading for an agent's synthetic user): bust the
      // org `agents` cache so the avatar URL refreshes on next load. The
      // processor's validateEntityAccess guarantees a mismatched entityId is
      // an agent user.
      if (session.entityId && session.entityId !== session.userId) {
        const { onCacheEvent } = await import('@auxx/lib/cache')
        await onCacheEvent('agent.updated', { orgId: session.organizationId })
      }
    }

    // 3.3 Enqueue derived thumbnails. This is the ONLY place they are enqueued,
    // and it sits after `db.transaction` has returned so the enqueue's own
    // connection resolves the version this upload just created.
    const thumbnails = new Map<ThumbnailPreset, { status: string; assetId?: string }>()
    const presets = postCommitPresetsFor(session.entityType)
    if (result.assetId && presets.length > 0) {
      const { createProductionQueuePort, ensureThumbnail } = await import('@auxx/lib/files/server')
      const thumbCtx = { db, organizationId: session.organizationId }
      const thumbDeps = { queue: createProductionQueuePort(), now: () => new Date() }
      for (const preset of presets) {
        try {
          const enq = await ensureThumbnail(thumbCtx, thumbDeps, {
            source: { type: 'asset', assetId: result.assetId },
            createdById: session.userId,
            opts: {
              preset,
              visibility: 'PUBLIC',
              ...(preset === AVATAR_USER_IMAGE_PRESET ? { updateUser: true } : {}),
            },
          })
          if (enq.isErr()) throw enq.error
          thumbnails.set(preset, enq.value as { status: string; assetId?: string })
        } catch (thumbErr) {
          // A derived image must never fail an upload whose bytes and rows are
          // already durable.
          logger.error('Failed to enqueue thumbnail preset', {
            sessionId,
            assetId: result.assetId,
            preset,
            error: String(thumbErr),
          })
        }
      }
    }

    // 3.4 Compute the download URL returned to the client for preview
    let downloadUrl: string | null = null
    try {
      if (result.assetId) {
        const { MediaAssetService } = await import('@auxx/lib/files/server')
        const assetService = new MediaAssetService(session.organizationId, session.userId)

        // Prefer the tiny avatar when 3.3 found it already generated; otherwise
        // the original, which is what the client previews until the job lands.
        const preview = thumbnails.get(AVATAR_PREVIEW_PRESET)
        downloadUrl =
          preview?.status === 'ready' && preview.assetId
            ? await assetService.getDownloadUrl(preview.assetId)
            : await assetService.getDownloadUrl(result.assetId)
      }
    } catch (urlErr) {
      logger.warn('Failed to get download URL', {
        sessionId,
        assetId: result.assetId,
        error: String(urlErr),
      })
    }

    // 3.5 Kick off background jobs (if needed)
    // await BackgroundJobManager.scheduleProcessing(result.fileId)

    return NextResponse.json({
      success: true,
      sessionId,
      storageLocationId,
      fileId: result.fileId,
      assetId: result.assetId,
      attachmentId: result.attachmentId,
      documentId: result.documentId,
      url: downloadUrl || undefined,
    })
  } catch (error) {
    // This is a raw App Router handler with no `auxxErrorMiddleware`, but the
    // status now comes off the thrown `AuxxError` itself (PR 4c), so an
    // AuxxError — e.g. `ProcessorRegistry.getForEntityType`'s `BadRequestError`
    // — keeps its own status without a second hand-rolled re-wrap here. The
    // handler also marks the session failed, which is why it still runs.
    return await UploadErrorHandler.handleUploadError(error, sessionId, 'upload-completion')
  }
}
