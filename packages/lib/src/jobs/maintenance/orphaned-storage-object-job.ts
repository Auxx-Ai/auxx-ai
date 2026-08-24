// packages/lib/src/jobs/maintenance/orphaned-storage-object-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { ProviderId } from '../../files/adapters/base-adapter'
import { StorageManager } from '../../files/storage/storage-manager'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('orphaned-storage-object-job')

/**
 * One orphaned storage object to delete.
 *
 * `bucket` is what makes this correct: the object of a PUBLIC upload lives in
 * the public bucket, and a delete aimed at the private one returns 204 for the
 * missing key while the real object leaks.
 */
export interface OrphanedStorageObjectJobData {
  provider: ProviderId
  bucket?: string
  key: string
  credentialId?: string
  organizationId?: string
  /** Why the object was orphaned, for the audit trail. */
  reason: string
}

/**
 * Delete one orphaned storage object.
 *
 * Compensation for an upload whose DB transaction failed after the bytes were
 * already in the bucket. The route deletes inline first; this job is the
 * durable retry for when that inline delete throws.
 *
 * Deliberately rethrows: BullMQ's retry/backoff is the whole point of moving
 * this off the request path, and a swallowed error would put us back where the
 * stubbed `CleanupService` was.
 */
export async function orphanedStorageObjectJob(
  ctx: JobContext<OrphanedStorageObjectJobData>
): Promise<{ deleted: true }> {
  const { provider, bucket, key, credentialId, organizationId, reason } = ctx.data

  logger.info('Deleting orphaned storage object', {
    provider,
    bucket,
    key,
    organizationId,
    reason,
    jobId: ctx.jobId,
  })

  const storageManager = new StorageManager(organizationId)

  try {
    await storageManager.deleteByKey({ provider, key, bucket, credentialId })
  } catch (error) {
    logger.error('Failed to delete orphaned storage object', {
      provider,
      bucket,
      key,
      organizationId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  logger.info('Deleted orphaned storage object', { provider, bucket, key, organizationId })

  return { deleted: true }
}

/**
 * Enqueue an orphaned-object delete on the maintenance queue, best-effort.
 *
 * ## The swallow is the whole reason this wrapper exists
 *
 * `QueuePort.enqueueStorageCleanup` returns the job id and **throws**; this
 * returns `void` and logs. `plans/attachments/05-core-services.md` §5.6.1 flags
 * the mismatch and says one of the two has to give — PR 5f decided in favour of
 * the port, and moved the swallow *here*, where it can be justified in one
 * sentence: compensation must never turn a failed upload into a failed request,
 * because the bytes are already in the bucket and the caller is on its way to
 * returning an error to the user either way.
 *
 * Putting that `try/catch` inside the port instead would have made every future
 * caller inherit fail-open behaviour it never asked for and could not opt out
 * of, and would have thrown away the job id — which is what lets a test assert
 * *which* job was scheduled without a queue running.
 *
 * The enqueue itself now goes through the port, so the job options live in one
 * place (`files/storage/queue-port.ts`) rather than in two copies that drift.
 *
 * `bucket` is optional on {@link OrphanedStorageObjectJobData} and required on
 * the port, so a call with no bucket is refused here rather than being
 * normalised to `'default'` and producing a job the worker cannot execute
 * correctly (#1816: a delete against the wrong bucket 204s and the object
 * leaks).
 */
export async function enqueueOrphanedStorageObjectCleanup(
  data: OrphanedStorageObjectJobData
): Promise<void> {
  try {
    if (!data.bucket) {
      throw new Error('orphaned storage object cleanup requires an explicit bucket')
    }

    const { createProductionQueuePort } = await import('../../files/storage/queue-port')
    const jobId = await createProductionQueuePort().enqueueStorageCleanup({
      ...data,
      bucket: data.bucket,
    })

    logger.info('Enqueued orphaned storage object cleanup', {
      jobId,
      provider: data.provider,
      bucket: data.bucket,
      key: data.key,
      reason: data.reason,
    })
  } catch (error) {
    logger.error('Failed to enqueue orphaned storage object cleanup', {
      provider: data.provider,
      bucket: data.bucket,
      key: data.key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
