// apps/web/src/app/api/files/upload/[sessionId]/parts/route.ts

import {
  createStorageManager,
  touchUploadSession,
  UploadErrorHandler,
  uploadSessionRedis,
} from '@auxx/lib/files/server'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeUploadSession } from '../authorize-upload-session'

const PartRequestSchema = z.object({
  partNumber: z.number().int().positive(),
  size: z.number().positive(),
})

interface RouteParams {
  params: Promise<{ sessionId: string }>
}

/**
 * Generate presigned URL for multipart upload part
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params

    // Authenticate FIRST: this endpoint used to mint presigned `UploadPart` URLs
    // for arbitrary part numbers to anyone holding the session nanoid
    // (`docs/files-upload-architecture-guide.md` §11.4).
    const authorized = await authorizeUploadSession(sessionId)
    if (authorized instanceof Response) return authorized
    const { session } = authorized

    let body, partRequest
    try {
      body = await request.json()
      partRequest = PartRequestSchema.parse(body)
    } catch (validationError) {
      return UploadErrorHandler.validationError('Invalid part request format', {
        validationErrors: validationError,
      })
    }

    const { partNumber, size } = partRequest

    if (!session.isMultipart || !session.uploadId) {
      return UploadErrorHandler.validationError('Not a multipart upload session', {
        isMultipart: session.isMultipart,
        hasUploadId: !!session.uploadId,
      })
    }

    // Touch session to extend TTL during active upload
    await touchUploadSession(await uploadSessionRedis(), sessionId, () => new Date())

    const storageManager = createStorageManager(session.organizationId)

    try {
      const presigned = await storageManager.generatePartUploadUrl({
        provider: session.provider,
        key: session.storageKey,
        uploadId: session.uploadId,
        partNumber,
        size,
        // The multipart upload was initiated in `session.bucket`; presigning a
        // part against any other bucket fails with `NoSuchUpload` (guide §11.5).
        bucket: session.bucket,
        // NOTE (still true): `StorageManager.generatePartUploadUrl` takes no
        // `ttlSec` and forwards none, so part URLs use `S3Adapter.presignPart`'s
        // 3600s default rather than `session.ttlSec`.
        credentialId: session.credentialId,
      })

      return NextResponse.json({
        partNumber,
        presignedUrl: presigned.url, // This will be a PUT URL for S3-style providers
        // No fields for multipart parts - they use PUT with raw body
      })
    } catch (presignError) {
      return await UploadErrorHandler.handleUploadError(
        presignError,
        sessionId,
        'part-presign-generation',
        { partNumber, size }
      )
    }
  } catch (error) {
    const { sessionId } = await params
    return await UploadErrorHandler.handleUploadError(error, sessionId, 'part-request-processing')
  }
}
