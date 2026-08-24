// packages/lib/src/files/upload/abort.ts

/**
 * Releasing a multipart upload that will never be completed.
 *
 * ## Why this exists
 *
 * A single-part PUT that the browser abandons leaves nothing behind: S3 only
 * materialises the object when the request finishes. A **multipart** upload is
 * the opposite. `CreateMultipartUpload` opens server-side state immediately,
 * every part that lands is stored, and S3 keeps and bills for those parts
 * **forever** unless something aborts the upload or a lifecycle rule expires it.
 *
 * Until this module there was no abort anywhere in the codebase, so cancelling a
 * multipart upload leaked every part that had already landed. A 184 MB cancel
 * during the phase-10 browser test left exactly that behind, and it was still
 * there — immortal — when it was found by hand.
 *
 * The `expiresAt` that {@link startMultipartUpload} returns is not a safety net
 * and never was. It describes how long the presigned part URLs stay signable;
 * the upload itself has no expiry. The S3 adapter used to carry a
 * `// 7 days (S3 default)` comment next to it, which is what made the gap look
 * closed.
 *
 * ## Best-effort, always
 *
 * This runs while the caller is already cancelling. A failed abort must never
 * turn a cancel into an error the user sees: the cancel succeeded, and the cost
 * of the leak is storage the lifecycle rule will reclaim. So this never throws,
 * exactly like {@link compensateUploadObject}, and reports what happened instead.
 *
 * ## This is not the only defence, and must not be the only one
 *
 * A browser that is closed, crashes, or loses the network mid-upload never
 * reaches this code — no client-side handler can be relied on to run. The
 * durable backstop is an `AbortIncompleteMultipartUpload` lifecycle rule on the
 * bucket, which is infrastructure, not application code. Both are required:
 * this reclaims the bytes in seconds for the common case, the rule catches
 * everything else.
 *
 * ## `bucket` is not optional and is never defaulted
 *
 * Same rule as every other storage call. Aborting against the wrong bucket does
 * at least fail loudly with `NoSuchUpload` rather than 204-ing like a delete
 * does, but the real parts still leak, so the bucket comes from the session that
 * started the upload and is never re-derived here.
 */

import { createScopedLogger } from '@auxx/logger'
import type { FilesDepsSlice } from '../ctx'
import type { ObjectRef } from '../storage/ports'

const logger = createScopedLogger('upload-abort')

/** Storage only. There is no durable fallback — see {@link AbortOutcome}. */
export type AbortDeps = FilesDepsSlice<'storage'>

/** The multipart upload to release. */
export interface AbortInput extends ObjectRef {
  /**
   * The `UploadId` S3 returned from `CreateMultipartUpload`, absent on a
   * single-part session. Optional because that is exactly what the upload
   * session carries, and narrowing it here would only move the check to every
   * caller.
   */
  uploadId?: string
  /** Why it is being abandoned. Log triage only. */
  reason: string
  /** Correlation for the log lines only. */
  sessionId?: string
}

/** What the abort managed to do, so a caller can log or assert on it. */
export type AbortOutcome =
  /** S3 released the parts. */
  | 'aborted'
  /** Nothing to abort: the session never opened a multipart upload. */
  | 'skipped'
  /**
   * The abort failed. The parts are leaked until the bucket's
   * `AbortIncompleteMultipartUpload` lifecycle rule expires them.
   *
   * Deliberately no queued fallback: a cleanup job would need the `uploadId`,
   * which is meaningless once S3 has expired the upload, and the lifecycle rule
   * already covers the same case more reliably than a job could.
   */
  | 'failed'

/**
 * Release an in-flight multipart upload so S3 stops holding its parts.
 *
 * Never throws. See the file header for why, and for why the lifecycle rule is
 * still required alongside this.
 *
 * @param deps Storage port — see {@link AbortDeps}.
 * @param input The upload, its bucket and key, and why it is being abandoned.
 * @returns `'skipped'` when there was no multipart upload to release.
 */
export async function abortMultipartUpload(
  deps: AbortDeps,
  input: AbortInput
): Promise<AbortOutcome> {
  // A single-part session has no `uploadId` and needs no cleanup: an abandoned
  // PUT never becomes an object.
  if (!input.uploadId) return 'skipped'

  try {
    await deps.storage.abortMultipart({
      provider: input.provider,
      bucket: input.bucket,
      key: input.key,
      credentialId: input.credentialId,
      uploadId: input.uploadId,
    })
    return 'aborted'
  } catch (error) {
    logger.warn('Multipart abort failed; parts leak until the lifecycle rule expires them', {
      sessionId: input.sessionId,
      key: input.key,
      bucket: input.bucket,
      uploadId: input.uploadId,
      reason: input.reason,
      error,
    })
    return 'failed'
  }
}
