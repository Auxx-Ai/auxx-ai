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
 * Enqueue an orphaned-object delete on the maintenance queue.
 *
 * Best-effort at the call site: compensation must never turn a failed upload
 * into a failed request, so an enqueue failure is logged, not thrown.
 */
export async function enqueueOrphanedStorageObjectCleanup(
  data: OrphanedStorageObjectJobData
): Promise<void> {
  try {
    const { getQueue } = await import('../queues')
    const { Queues } = await import('../queues/types')
    const queue = getQueue(Queues.maintenanceQueue)

    await queue.add('orphanedStorageObjectJob', data, {
      // Same object from a retried completion is the same unit of work.
      jobId: `orphaned-storage-object:${data.bucket ?? 'default'}:${data.key}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
      priority: 10,
    })

    logger.info('Enqueued orphaned storage object cleanup', {
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
