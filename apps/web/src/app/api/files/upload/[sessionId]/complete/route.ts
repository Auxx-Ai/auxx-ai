// apps/web/src/app/api/files/upload/[sessionId]/complete/route.ts

import { database as db } from '@auxx/database'
import {
  completeUpload,
  createProductionCachePort,
  createProductionQueuePort,
  createS3StoragePort,
  failUploadSession,
  uploadErrorResponse,
  uploadSessionRedis,
  uploadValidationError,
} from '@auxx/lib/files/server'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeUploadSession } from '../authorize-upload-session'

/** The clock every session write on this request is stamped against. */
const now = () => new Date()

const CompletionSchema = z.object({
  // Advisory: the server knows the key from the session and never reads this.
  storageKey: z.string().optional(),
  size: z.number().positive(),
  mimeType: z.string(),
  etag: z.string().optional(),
  uploadId: z.string().optional(),
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string() }))
    .optional(),
})

interface RouteParams {
  params: Promise<{ sessionId: string }>
}

/**
 * Complete a presigned upload.
 *
 * Two responsibilities and no third (plan §4.7): **authenticate** — the session
 * nanoid used to be the only credential here, so anyone holding one could
 * complete someone else's upload (#1818, guide §11.4) — and translate
 * `Result` → `Response`. The three-phase structure this handler used to document
 * in comments (S3 → one transaction → post-commit) is `completeUpload`'s, where
 * it is enforced by the code rather than described by it.
 *
 * `failUploadSession` is called **explicitly** on the failure path. It used to
 * be a hidden side effect inside `UploadErrorHandler.handleUploadError`; it is a
 * Redis write, and the status gate it feeds is what stops a client retrying a
 * completion whose first attempt died mid-flight.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params

  try {
    const authorized = await authorizeUploadSession(sessionId)
    if (authorized instanceof Response) return authorized
    const { session } = authorized

    let completion: z.infer<typeof CompletionSchema>
    try {
      completion = CompletionSchema.parse(await request.json())
    } catch (validationError) {
      // An early return, not a throw: a malformed body means nothing was
      // attempted, so it must not mark the session failed and force the client
      // to re-upload the bytes.
      return uploadValidationError('Invalid completion request format', {
        validationErrors: validationError,
      })
    }

    const redis = await uploadSessionRedis()
    const result = await completeUpload(
      { db, organizationId: session.organizationId },
      {
        storage: createS3StoragePort(session.organizationId),
        queue: createProductionQueuePort(),
        // Post-commit invalidation only. The `USER_PROFILE` and `CHAT_WIDGET`
        // handlers used to lazily import `@auxx/lib/cache` themselves, which put
        // their busts outside every ordering guarantee the ports provide (PR 6c).
        cache: createProductionCachePort(),
        now,
        redis,
      },
      session,
      completion
    )

    if (result.isErr()) {
      await failUploadSession(redis, sessionId, now)
      return uploadErrorResponse(result.error, { operation: 'upload-completion', sessionId })
    }

    return NextResponse.json({ success: true, ...result.value })
  } catch (error) {
    // Only reachable before `completeUpload` returns a `Result` — an unavailable
    // Redis, or a request body that cannot be read at all.
    return uploadErrorResponse(error, { operation: 'upload-completion', sessionId })
  }
}
