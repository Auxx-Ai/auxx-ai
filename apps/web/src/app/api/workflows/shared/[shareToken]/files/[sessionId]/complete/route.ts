// apps/web/src/app/api/workflows/shared/[shareToken]/files/[sessionId]/complete/route.ts

import { database } from '@auxx/database'
import type { FilesCtx } from '@auxx/lib/files/server'
import {
  compensateUploadObject,
  createAssetWithVersion,
  createProductionQueuePort,
  createS3StoragePort,
  createStorageManager,
  getAssetDownloadRef,
} from '@auxx/lib/files/server'
import { SystemUserService } from '@auxx/lib/users'
import { createScopedLogger } from '@auxx/logger'
import { deleteRedisData, getRedisData } from '@auxx/redis'
import { verifyWorkflowPassport } from '@auxx/services/workflow-share'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('public-file-upload-complete')

/**
 * Session data stored in Redis
 */
interface UploadSessionData {
  storageKey: string
  filename: string
  mimeType: string
  size: number
  organizationId: string
  endUserId: string
  shareToken: string
  nodeId: string
  bucket: string
}

/**
 * POST /api/workflows/shared/[shareToken]/files/[sessionId]/complete
 * Completes the upload and creates a storage location record
 *
 * Requires a valid passport token in Authorization header
 *
 * ## Compensation
 *
 * The browser PUTs the bytes straight to S3 against a presigned URL, so by the
 * time this handler runs the object already exists and nothing references it.
 * Every failure between "the object is confirmed present" and "the rows are
 * committed" therefore leaks bytes unless it compensates, which is what
 * `compensateUploadObject` is for — same policy, same module, as the main
 * completion path in `packages/lib/src/files/upload/complete.ts`.
 *
 * Two failures deliberately do **not** compensate; see {@link POST}'s inline
 * comments at each branch.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shareToken: string; sessionId: string }> }
) {
  const { shareToken, sessionId } = await context.params

  // 1. Verify passport token
  const authHeader = request.headers.get('authorization')
  const passportToken = authHeader?.replace('Bearer ', '')

  if (!passportToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const passportResult = await verifyWorkflowPassport(passportToken)
  if (passportResult.isErr()) {
    logger.warn('Invalid passport token for upload completion', { error: passportResult.error })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const passport = passportResult.value

  // 2. Get session from Redis
  const sessionData = (await getRedisData(
    `public-upload:${sessionId}`,
    false
  )) as UploadSessionData | null
  if (!sessionData) {
    return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 })
  }

  // 3. Verify session belongs to this share token and end user
  if (sessionData.shareToken !== shareToken) {
    return NextResponse.json({ error: 'Invalid session for this workflow' }, { status: 403 })
  }

  if (sessionData.endUserId !== passport.endUserId) {
    return NextResponse.json({ error: 'Invalid session for this user' }, { status: 403 })
  }

  // 3b. The bucket is the one thing compensation cannot guess.
  //
  // S3 answers 204 No Content for a delete of a key that is not in the bucket
  // you named, so a wrong-bucket cleanup reports success and leaks the object
  // with no error anywhere — bugs #1816/#1817/#1818 were all that one shape.
  // The session route records the bucket it presigned against; if it is not
  // there, this request cannot HEAD the object either, and inventing a default
  // would be exactly the failure mode this guard exists to prevent.
  if (!sessionData.bucket) {
    logger.error('Upload session has no bucket; refusing to guess one', {
      sessionId,
      organizationId: sessionData.organizationId,
      storageKey: sessionData.storageKey,
    })
    return NextResponse.json({ error: 'Failed to complete upload' }, { status: 500 })
  }

  /**
   * Undo an object whose rows never landed, then retire the session.
   *
   * Never throws — it is called while the handler is already reporting a
   * failure, and replacing that failure with a storage error would lose the
   * only actionable information. The Redis session is dropped afterwards
   * because the bytes it points at are gone: leaving it would let a retry get
   * as far as a confusing "File not found in storage" and compensate a second
   * time.
   */
  const compensate = async (reason: string) => {
    const outcome = await compensateUploadObject(
      {
        storage: createS3StoragePort(sessionData.organizationId),
        queue: createProductionQueuePort(),
      },
      {
        provider: 'S3',
        bucket: sessionData.bucket,
        key: sessionData.storageKey,
        organizationId: sessionData.organizationId,
        reason,
        sessionId,
      }
    )
    logger.info('Compensated an orphaned public workflow upload', {
      sessionId,
      outcome,
      reason,
      storageKey: sessionData.storageKey,
      bucket: sessionData.bucket,
    })
    await deleteRedisData(`public-upload:${sessionId}`, false)
  }

  // 4. Verify file exists in S3
  const storageManager = createStorageManager(sessionData.organizationId)
  let headResult: Awaited<ReturnType<typeof storageManager.headByKey>>
  try {
    headResult = await storageManager.headByKey({
      provider: 'S3',
      key: sessionData.storageKey,
      bucket: sessionData.bucket,
    })
  } catch (err) {
    // NO compensation. This branch is the one place the object's existence is
    // unconfirmed: the usual cause is that the browser never completed its PUT,
    // so there is nothing to delete, and if instead the HEAD failed
    // transiently, deleting would destroy bytes a retry can still commit. The
    // session is left in Redis for exactly that retry.
    logger.error('File not found in storage', {
      sessionId,
      storageKey: sessionData.storageKey,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'File not found in storage' }, { status: 404 })
  }

  // 5. Get system user for the organization (public uploads use org's system user)
  let systemUserId: string
  try {
    systemUserId = await SystemUserService.getSystemUserForActions(sessionData.organizationId)
  } catch (err) {
    // Compensates: the HEAD above proved the object is there, and a missing
    // system user is an organization-configuration fault that a retry inside
    // the session's TTL will hit again. Nothing will ever reference the bytes.
    logger.error('No system user found for organization', {
      organizationId: sessionData.organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
    await compensate(`Public workflow upload has no system user: ${String(err)}`)
    return NextResponse.json({ error: 'Organization configuration error' }, { status: 500 })
  }

  // 6. Write the StorageLocation, the MediaAsset and its first version in ONE
  //    transaction, so a failure of any of them rolls back the other two.
  //
  //    `createStorageLocation` used to run on the pool, before the transaction
  //    below was opened, which meant a failed asset insert left a committed
  //    `StorageLocation` row pointing at bytes this handler was about to delete.
  //    It rides the caller's transaction now, matching `completeUpload`'s
  //    phase 2. The bucket is passed explicitly and is non-empty (guard 3b), so
  //    the facade's metadata preparation short-circuits and performs no
  //    credential lookup from inside the open transaction.
  const filesCtx: FilesCtx = { db: database, organizationId: sessionData.organizationId }
  let storageLocationId: string
  let asset: { id: string }
  let version: { id: string }
  try {
    const created = await database.transaction(async (tx) => {
      const location = await storageManager.createStorageLocation(
        {
          provider: 'S3',
          externalId: sessionData.storageKey,
          size: headResult.size,
          mimeType: headResult.mimeType || sessionData.mimeType,
          metadata: {
            source: 'public-workflow',
            endUserId: sessionData.endUserId,
            shareToken: sessionData.shareToken,
            nodeId: sessionData.nodeId,
            originalFileName: sessionData.filename,
          },
          bucket: sessionData.bucket,
          visibility: 'PRIVATE',
        },
        { tx }
      )

      const result = await createAssetWithVersion(
        tx,
        { ...filesCtx, db: tx },
        { now: () => new Date() },
        {
          kind: 'TEMP_UPLOAD',
          name: sessionData.filename,
          mimeType: headResult.mimeType || sessionData.mimeType,
          size: headResult.size,
          isPrivate: true,
          createdById: systemUserId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          purpose: 'PUBLIC_WORKFLOW_INPUT',
          storageLocationId: location.id,
        }
      )
      // Thrown, not returned: `db.transaction` rolls back on a throw, and an
      // `err()` is an ordinary resolved value the transaction would commit
      // around.
      if (result.isErr()) throw result.error

      return { location, ...result.value }
    })
    storageLocationId = created.location.id
    asset = created.asset
    version = created.version
  } catch (err) {
    // The rows rolled back; the bytes did not.
    logger.error('Failed to persist public workflow upload', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    await compensate(`Public workflow upload transaction failed: ${String(err)}`)
    return NextResponse.json({ error: 'Failed to complete upload' }, { status: 500 })
  }

  // 7. Generate download URL using the new version
  let downloadUrl: string | undefined
  try {
    const downloadRef = await getAssetDownloadRef(
      filesCtx,
      { storage: createS3StoragePort(sessionData.organizationId) },
      asset.id
    )
    if (downloadRef.isErr()) throw downloadRef.error
    if (downloadRef.value.type === 'url') {
      downloadUrl = downloadRef.value.url
    }
  } catch (err) {
    // NO compensation, and non-critical besides: the rows are committed and the
    // object is referenced by them, so it is not orphaned. Deleting it here
    // would destroy a file the caller is about to be told it owns.
    logger.warn('Failed to generate download URL', {
      assetId: asset.id,
      versionId: version.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // 8. Clean up Redis session
  await deleteRedisData(`public-upload:${sessionId}`, false)

  logger.info('Completed public file upload with MediaAsset', {
    sessionId,
    assetId: asset.id,
    versionId: version.id,
    storageLocationId,
    filename: sessionData.filename,
    size: headResult.size,
  })

  // 9. Return file metadata with version locking support
  return NextResponse.json({
    // New fields for FileReference compatibility
    assetId: asset.id,
    versionId: version.id,

    // Legacy fields for backwards compatibility
    id: asset.id,
    fileId: asset.id,

    // Metadata
    filename: sessionData.filename,
    mimeType: headResult.mimeType || sessionData.mimeType,
    size: headResult.size,
    url: downloadUrl,
  })
}
