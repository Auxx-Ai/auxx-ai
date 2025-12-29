// apps/web/src/app/api/workflows/shared/[shareToken]/files/[sessionId]/complete/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createStorageManager, MediaAssetService } from '@auxx/lib/files'
import { SystemUserService } from '@auxx/lib/users'
import { verifyWorkflowPassport } from '@auxx/services/workflow-share'
import { getRedisData, deleteRedisData } from '@auxx/redis'
import { createScopedLogger } from '@auxx/logger'

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
  const sessionData = await getRedisData(`public-upload:${sessionId}`, false) as UploadSessionData | null
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

  // 4. Verify file exists in S3
  const storageManager = createStorageManager(sessionData.organizationId)
  let headResult
  try {
    headResult = await storageManager.headByKey({
      provider: 'S3',
      key: sessionData.storageKey,
      bucket: sessionData.bucket,
    })
  } catch (err) {
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
    logger.error('No system user found for organization', {
      organizationId: sessionData.organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Organization configuration error' }, { status: 500 })
  }

  // 6. Create StorageLocation record
  let storageLocation
  try {
    storageLocation = await storageManager.createStorageLocation({
      provider: 'S3',
      externalId: sessionData.storageKey,
      size: BigInt(headResult.size),
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
    })
  } catch (err) {
    logger.error('Failed to create storage location', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to complete upload' }, { status: 500 })
  }

  // 7. Create MediaAsset with version for version locking support
  let asset: Awaited<ReturnType<typeof mediaAssetService.createWithVersion>>['asset']
  let version: Awaited<ReturnType<typeof mediaAssetService.createWithVersion>>['version']
  const mediaAssetService = new MediaAssetService(sessionData.organizationId, systemUserId)
  try {
    const result = await mediaAssetService.createWithVersion(
      {
        kind: 'TEMP_UPLOAD',
        name: sessionData.filename,
        mimeType: headResult.mimeType || sessionData.mimeType,
        size: BigInt(headResult.size),
        isPrivate: true,
        organizationId: sessionData.organizationId,
        createdById: systemUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        purpose: 'PUBLIC_WORKFLOW_INPUT',
      },
      storageLocation.id
    )
    asset = result.asset
    version = result.version
  } catch (err) {
    logger.error('Failed to create MediaAsset', {
      sessionId,
      storageLocationId: storageLocation.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to complete upload' }, { status: 500 })
  }

  // 8. Generate download URL using the new version
  let downloadUrl: string | undefined
  try {
    const downloadRef = await mediaAssetService.getDownloadRef(asset.id)
    if (downloadRef.type === 'url') {
      downloadUrl = downloadRef.url
    }
  } catch (err) {
    // Non-critical - download URL is optional for form submission
    logger.warn('Failed to generate download URL', {
      assetId: asset.id,
      versionId: version.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // 9. Clean up Redis session
  await deleteRedisData(`public-upload:${sessionId}`, false)

  logger.info('Completed public file upload with MediaAsset', {
    sessionId,
    assetId: asset.id,
    versionId: version.id,
    storageLocationId: storageLocation.id,
    filename: sessionData.filename,
    size: headResult.size,
  })

  // 10. Return file metadata with version locking support
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
