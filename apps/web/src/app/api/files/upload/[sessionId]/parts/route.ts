// apps/web/src/app/api/files/upload/[sessionId]/parts/route.ts

import {
  createS3StoragePort,
  presignPart,
  touchUploadSession,
  uploadErrorResponse,
  uploadSessionRedis,
  uploadValidationError,
} from '@auxx/lib/files/server'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeUploadSession } from '../authorize-upload-session'

/** The clock the TTL extension is computed against. */
const now = () => new Date()

const PartRequestSchema = z.object({
  partNumber: z.number().int().positive(),
  size: z.number().positive(),
})

interface RouteParams {
  params: Promise<{ sessionId: string }>
}

/**
 * Presign one part of an in-flight multipart upload.
 *
 * ## Nothing on this route marks the session failed — deliberately (PR 4e)
 *
 * It used to. `UploadErrorHandler.handleUploadError` wrote
 * `status: 'failed'` for every error it saw, and this route called it on both
 * its catch paths, so **one failed part presign killed the whole upload**. PR 4c
 * preserved that while it moved the write out of the error handler and flagged
 * it for this PR. The call is now visible at the call site, and the answer is
 * that it should not be here at all:
 *
 * - **A part presign mutates nothing.** It signs a URL. There is no half-run
 *   state to protect a retry from, which is the only thing the `failed` status
 *   exists for (`upload/session.ts`, `failUploadSession`).
 * - **The failure it fires on is the retryable kind.** An expired credential, a
 *   throttled `resolveProviderAuth`, a transient S3 error — the client asks for
 *   the same part again and it works.
 * - **The write is not even a clean kill.** It does not abort the S3 multipart
 *   upload, so the parts already written stay there unreferenced; it only makes
 *   `complete` refuse the session, forcing a full re-upload and leaving an
 *   orphaned multipart upload behind. It converted a retryable blip into
 *   guaranteed data loss plus garbage.
 *
 * So a failure here returns the classified error and leaves the session alive.
 * `complete` still refuses a session someone genuinely failed, because
 * `completeUpload`'s own failure path is where `failUploadSession` is called.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params

  try {
    // Authenticate FIRST: this endpoint used to mint presigned `UploadPart` URLs
    // for arbitrary part numbers to anyone holding the session nanoid
    // (`docs/files-upload-architecture-guide.md` §11.4).
    const authorized = await authorizeUploadSession(sessionId)
    if (authorized instanceof Response) return authorized
    const { session } = authorized

    let partRequest: z.infer<typeof PartRequestSchema>
    try {
      partRequest = PartRequestSchema.parse(await request.json())
    } catch (validationError) {
      return uploadValidationError('Invalid part request format', {
        validationErrors: validationError,
      })
    }

    if (!session.isMultipart || !session.uploadId) {
      return uploadValidationError('Not a multipart upload session', {
        isMultipart: session.isMultipart,
        hasUploadId: !!session.uploadId,
      })
    }

    // Extend the session's lifetime while the upload is actively running.
    await touchUploadSession(await uploadSessionRedis(), sessionId, now)

    const presigned = await presignPart(createS3StoragePort(session.organizationId), {
      provider: session.provider,
      key: session.storageKey,
      uploadId: session.uploadId,
      partNumber: partRequest.partNumber,
      size: partRequest.size,
      // The multipart upload was initiated in `session.bucket`; presigning a
      // part against any other bucket fails with `NoSuchUpload` (guide §11.5).
      bucket: session.bucket,
      // NOTE (still true): the part presign takes no `ttlSec`, so part URLs use
      // `S3Adapter.presignPart`'s 3600s default rather than `session.ttlSec`.
      credentialId: session.credentialId,
    })

    if (presigned.isErr()) {
      return uploadErrorResponse(presigned.error, {
        operation: 'part-presign-generation',
        sessionId,
        context: { partNumber: partRequest.partNumber, size: partRequest.size },
      })
    }

    return NextResponse.json({
      partNumber: partRequest.partNumber,
      // A PUT URL for S3-style providers. Parts carry no form fields.
      presignedUrl: presigned.value.url,
    })
  } catch (error) {
    return uploadErrorResponse(error, { operation: 'part-request-processing', sessionId })
  }
}
