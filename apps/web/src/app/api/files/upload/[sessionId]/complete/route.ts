// apps/web/src/app/api/files/upload/[sessionId]/complete/route.ts

import { database as db } from '@auxx/database'
import {
  cleanupService,
  createStorageManager,
  ensureProcessorsInitialized,
  ProcessorRegistry,
  ProgressPublisher,
  SessionManager,
  UploadErrorHandler,
} from '@auxx/lib/files/server'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const logger = createScopedLogger('api-upload-complete')

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
 * Complete presigned upload and trigger processing
 * Implements three-phase approach: S3 operations -> DB transaction -> post-commit actions
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params

  try {
    const completion = CompletionSchema.parse(await request.json())
    const session = await SessionManager.getSession(sessionId)

    if (!session) return UploadErrorHandler.sessionNotFound(sessionId)
    if (!['created', 'uploading'].includes(session.status)) {
      return UploadErrorHandler.validationError('Invalid session status for completion', {
        currentStatus: session.status,
        expectedStatus: ['created', 'uploading'],
      })
    }

    const storageManager = createStorageManager(session.organizationId)

    // ============= PHASE 1: S3 OPERATIONS (OUTSIDE TRANSACTION) =============

    // 1.1 Complete multipart upload if applicable
    if (session.isMultipart) {
      if (!completion.uploadId || !completion.parts) {
        await ProgressPublisher.publishFailed(sessionId, 'Invalid multipart completion data')
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
        })
      } catch (err) {
        await SessionManager.updateSession(sessionId, { status: 'failed' })
        await ProgressPublisher.publishFailed(
          sessionId,
          `Multipart completion failed: ${String(err)}`
        )
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
      await SessionManager.updateSession(sessionId, { status: 'failed' })
      await ProgressPublisher.publishFailed(sessionId, `File verification failed: ${String(err)}`)
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
      await SessionManager.updateSession(sessionId, { status: 'failed' })
      await ProgressPublisher.publishFailed(sessionId, `Upload validation failed: ${String(err)}`)
      return NextResponse.json({ error: 'Upload validation failed' }, { status: 400 })
    }

    // 1.4 Update session with canonical values (best-effort, outside transaction)
    await SessionManager.updateSession(sessionId, {
      expectedSize: headResult.size,
      mimeType: headResult.mimeType || session.mimeType,
    })

    // ============= PHASE 2: SINGLE DB TRANSACTION =============

    let result: any
    let storageLocationId: string

    try {
      await db.transaction(
        async (tx) => {
          // 2.1 Build external URL for public assets (avatars, KB logos, etc.)
          let externalUrl = ''
          try {
            if (session.visibility === 'PUBLIC') {
              externalUrl = await storageManager.buildExternalUrl(
                session.provider,
                session.storageKey,
                session.credentialId,
                {
                  bucket: session.bucket,
                  visibility: session.visibility,
                }
              )
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
              size: BigInt(headResult.size),
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

          storageLocationId = storageLocation.id

          // 2.3 Let processor create Asset/File/Attachment with same TX
          result = await processor.process(session, storageLocation.id, { tx })

          // 2.4 Optionally persist domain outbox event
          // await tx.outboxEvent.create({ ... })
        },
        { timeout: 10000 }
      ) // Keep transaction short
    } catch (err) {
      // ============= COMPENSATION: S3 CLEANUP =============
      try {
        await storageManager.deleteByKey({
          provider: session.provider,
          key: session.storageKey,
          credentialId: session.credentialId,
        })
      } catch (cleanupErr) {
        logger.warn('Immediate S3 cleanup failed; scheduling for background cleanup', {
          key: session.storageKey,
          cleanupErr: String(cleanupErr),
        })

        // Schedule cleanup via background service
        await cleanupService.scheduleCleanup({
          provider: session.provider,
          storageKey: session.storageKey,
          credentialId: session.credentialId,
          reason: `DB transaction failed: ${String(err)}`,
          organizationId: session.organizationId,
        })
      }

      await SessionManager.updateSession(sessionId, { status: 'failed' })
      await ProgressPublisher.publishFailed(sessionId, `DB transaction failed: ${String(err)}`)
      return NextResponse.json({ error: 'File processing failed' }, { status: 500 })
    }

    // ============= PHASE 3: POST-COMMIT ACTIONS =============

    // 3.1 Update session status
    await SessionManager.updateSession(sessionId, {
      status: 'completed',
      storageLocationId,
    })

    // 3.2 Invalidate dehydration cache so next page load fetches fresh data
    if (session.entityType === 'USER_PROFILE') {
      const { DehydrationService } = await import('@auxx/lib/dehydration')
      const dehydrationService = new DehydrationService()
      await dehydrationService.invalidateUser(session.userId)
    }

    // 3.3 Compute download URL for SSE
    let downloadUrl: string | null = null
    try {
      if (session.entityType === 'USER_PROFILE' && result.assetId) {
        // For user avatars, try to get the tiny thumbnail URL first
        const { MediaAssetService } = await import('@auxx/lib/files/server')
        const assetService = new MediaAssetService(session.organizationId, session.userId)

        // Try to generate and get tiny avatar thumbnail URL
        const asset = await assetService.getWithRelations(result.assetId)
        if (asset?.currentVersion?.storageLocation) {
          // Ensure thumbnail is generated (won't reprocess if already exists)
          const { enqueueEnsureThumbnail } = await import('@auxx/lib/files/server')
          try {
            const enq = await enqueueEnsureThumbnail({
              organizationId: session.organizationId,
              userId: session.userId,
              source: { type: 'asset', assetId: result.assetId },
              opts: { preset: 'avatar-32', visibility: 'PUBLIC', queue: true },
            })
            if ((enq as any).status === 'ready' && (enq as any).assetId) {
              downloadUrl = await assetService.getDownloadUrl((enq as any).assetId)
            } else {
              downloadUrl = await assetService.getDownloadUrl(result.assetId)
            }
          } catch (thumbErr) {
            // If thumbnail generation fails, just use main asset
            logger.warn('Failed to ensure thumbnail, using main asset', {
              sessionId,
              assetId: result.assetId,
              error: String(thumbErr),
            })
            downloadUrl = await assetService.getDownloadUrl(result.assetId)
          }
        }
      } else if (result.assetId) {
        // For other entity types, get the main asset URL
        const { MediaAssetService } = await import('@auxx/lib/files/server')
        const assetService = new MediaAssetService(session.organizationId, session.userId)
        downloadUrl = await assetService.getDownloadUrl(result.assetId)
      }
    } catch (urlErr) {
      logger.warn('Failed to get download URL for SSE', {
        sessionId,
        assetId: result.assetId,
        error: String(urlErr),
      })
    }

    // 3.4 Publish progress events with URL for client preview
    await ProgressPublisher.publishCompleted(sessionId, {
      fileId: result.fileId,
      assetId: result.assetId,
      attachmentId: result.attachmentId,
      documentId: result.documentId,
      // Include structured result for upload store compatibility
      result: {
        uploadResults: [
          {
            fileId: sessionId,
            fileName: session.fileName,
            url: downloadUrl || undefined,
            checksum: headResult.etagOrRev,
          },
        ],
      },
    })

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
    return UploadErrorHandler.handleUploadError(error, sessionId, 'upload-completion')
  }
}
