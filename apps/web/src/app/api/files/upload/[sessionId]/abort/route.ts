// apps/web/src/app/api/files/upload/[sessionId]/abort/route.ts

import {
  abortMultipartUpload,
  createS3StoragePort,
  deleteUploadSession,
  uploadSessionRedis,
} from '@auxx/lib/files/server'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeUploadSession } from '../authorize-upload-session'

interface RouteParams {
  params: Promise<{ sessionId: string }>
}

/**
 * Abandon an upload session, releasing any multipart upload it opened.
 *
 * Cancel used to be purely client-side: the store aborted its `fetch` handles
 * and told the server nothing. That is correct for a single-part PUT, which
 * leaves no trace when abandoned, and wrong for a multipart upload, whose
 * already-uploaded parts S3 holds and bills for indefinitely — there is no
 * expiry without an explicit abort or a lifecycle rule.
 *
 * Authenticated through the same door as `complete` and `parts`: the session
 * nanoid is not a credential (#1818, guide §11.4), so a caller who merely holds
 * one must not be able to destroy another user's in-flight upload.
 *
 * Always 200 on an authorized call, including when the abort itself failed. The
 * client cancelled; surfacing a storage error it cannot act on would turn a
 * successful cancel into a visible failure. `outcome` carries what actually
 * happened for logging and tests, and the bucket's
 * `AbortIncompleteMultipartUpload` lifecycle rule is the backstop for both the
 * `failed` case and the browser that never called this at all.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params

  const authorized = await authorizeUploadSession(sessionId)
  if (authorized instanceof Response) return authorized

  const { session } = authorized

  const outcome = await abortMultipartUpload(
    { storage: createS3StoragePort() },
    {
      provider: session.provider,
      bucket: session.bucket,
      key: session.storageKey,
      credentialId: session.credentialId,
      uploadId: session.uploadId,
      reason: 'user-cancelled',
      sessionId,
    }
  )

  // The session is spent either way: its presigned URLs are useless once the
  // upload is abandoned, and leaving it in Redis lets a retry resume against an
  // `uploadId` S3 has already released.
  await deleteUploadSession(await uploadSessionRedis(), sessionId)

  return NextResponse.json({ success: true, outcome })
}
