// packages/lib/src/files/upload/compensate.ts

/**
 * Undoing an object whose rows never landed.
 *
 * An upload writes bytes to S3 *before* it writes a row, because a presigned PUT
 * is what the browser does with no server in the loop. So there is always a
 * window in which the object exists and nothing references it, and everything
 * that closes that window is here.
 *
 * ## The policy, and why it is two steps
 *
 * 1. **Delete now.** The caller is holding an error and the object is a known
 *    orphan; one `DeleteObject` closes it immediately.
 * 2. **If that fails, enqueue.** Storage being unreachable is exactly when the
 *    orphan is created *and* when the immediate delete cannot work, so the
 *    fallback has to be durable rather than another attempt in the same process.
 *
 * Neither step may throw. Compensation runs while the caller is in the middle of
 * reporting a failure, and replacing that failure with a storage error loses the
 * only information anyone can act on — strictly worse than leaking one object
 * that the orphan sweep will find. Both steps are logged instead.
 *
 * ## `bucket` is not optional and is never defaulted
 *
 * S3 answers **204 No Content** for a delete of a key that is not in the bucket
 * you named. A wrong-bucket compensation therefore reports success, leaks the
 * object, and leaves no error anywhere — the shape of #1816/#1817/#1818. Both
 * {@link DeleteParams} and {@link EnqueueStorageCleanupParams} make `bucket`
 * required for that reason, and this function takes it from the caller's ref
 * rather than resolving one.
 *
 * ## Why it is a module and not a `catch` block
 *
 * It was a private function inside `upload/complete.ts` until PR 6c. Two reasons
 * it moved:
 *
 * - **The property is now assertable on its own.** "On failure, either the
 *   object was deleted or a cleanup job was enqueued" is the Phase 6 exit
 *   criterion, and proving it through `completeUpload` meant standing up a
 *   session, a Redis double, a head result and a failing insert to reach four
 *   lines. Both ports are parameters here, so the test is the two ports and one
 *   ref.
 * - **`completeUpload` is not the only door that needs it.** The public
 *   workflow-share completion route
 *   (`apps/web/src/app/api/workflows/shared/[shareToken]/files/[sessionId]/complete/route.ts`)
 *   writes a `StorageLocation` and then a `MediaAsset`, and on failure of either
 *   returns a 500 having done **no** compensation at all — that object leaks
 *   today. Fixing it is a `catch` that calls this, not a second copy of the
 *   policy that can drift from this one.
 */

import { createScopedLogger } from '@auxx/logger'
import type { FilesDepsSlice } from '../ctx'
import type { ObjectRef } from '../storage/ports'

const logger = createScopedLogger('upload-compensate')

/** Storage for the immediate delete, queue for the durable fallback. Nothing else. */
export type CompensateDeps = FilesDepsSlice<'storage' | 'queue'>

/** The object to undo, plus the scope and reason the cleanup job records. */
export interface CompensateInput extends ObjectRef {
  organizationId: string
  /** Why the object is orphaned. Ends up on the maintenance job for triage. */
  reason: string
  /** Correlation for the log lines only. */
  sessionId?: string
}

/** What compensation actually managed to do, so a caller can log or assert on it. */
export type CompensationOutcome =
  /** The object is gone. */
  | 'deleted'
  /** The delete failed; a durable cleanup job holds the object. */
  | 'enqueued'
  /** Both failed. The object is leaked until the orphan sweep finds it. */
  | 'failed'

/**
 * Delete an orphaned upload object, falling back to a durable cleanup job.
 *
 * Never throws. See the file header for why, and for why `bucket` is required.
 *
 * @param deps Storage and queue ports — see {@link CompensateDeps}.
 * @param input The object, its org, and why it is orphaned.
 * @returns Which of the two steps succeeded, or `'failed'` if neither did.
 */
export async function compensateUploadObject(
  deps: CompensateDeps,
  input: CompensateInput
): Promise<CompensationOutcome> {
  try {
    await deps.storage.deleteObject({
      provider: input.provider,
      bucket: input.bucket,
      key: input.key,
      credentialId: input.credentialId,
    })
    return 'deleted'
  } catch (deleteError) {
    logger.warn('Immediate storage cleanup failed; scheduling for background cleanup', {
      sessionId: input.sessionId,
      key: input.key,
      bucket: input.bucket,
      error: deleteError,
    })
  }

  try {
    await deps.queue.enqueueStorageCleanup({
      provider: input.provider,
      bucket: input.bucket,
      key: input.key,
      credentialId: input.credentialId,
      organizationId: input.organizationId,
      reason: input.reason,
    })
    return 'enqueued'
  } catch (enqueueError) {
    logger.error('Could not schedule cleanup for an orphaned storage object', {
      sessionId: input.sessionId,
      key: input.key,
      bucket: input.bucket,
      error: enqueueError,
    })
    return 'failed'
  }
}
