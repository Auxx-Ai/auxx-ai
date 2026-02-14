// apps/web/src/app/api/files/upload/[sessionId]/parts/route.ts

import { createStorageManager, SessionManager, UploadErrorHandler } from '@auxx/lib/files/server'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

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

    const session = await SessionManager.getSession(sessionId)
    if (!session) {
      return UploadErrorHandler.sessionNotFound(sessionId)
    }

    if (!session.isMultipart || !session.uploadId) {
      return UploadErrorHandler.validationError('Not a multipart upload session', {
        isMultipart: session.isMultipart,
        hasUploadId: !!session.uploadId,
      })
    }

    // Touch session to extend TTL during active upload
    await SessionManager.touchSession(sessionId)

    const storageManager = createStorageManager(session.organizationId)

    try {
      const presigned = await storageManager.generatePartUploadUrl({
        provider: session.provider,
        key: session.storageKey,
        uploadId: session.uploadId,
        partNumber,
        size,
        ttlSec: session.ttlSec,
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
