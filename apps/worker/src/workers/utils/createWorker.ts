// apps/worker/src/workers/utils/createWorker.ts

import type { JobHandler, LegacyJobHandler } from '@auxx/lib/jobs'
import type { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { getConnectionOptions } from '@auxx/redis'
import { Job, Worker, type WorkerOptions } from 'bullmq'
import { createJobHandler } from './createJobHandler'

const logger = createScopedLogger('worker')

/**
 * Enhanced worker options extending BullMQ WorkerOptions
 */
export interface EnhancedWorkerOptions extends Omit<WorkerOptions, 'connection'> {
  /** Enable job cancellation support (default: true) */
  enableCancellation?: boolean

  /** Log level for this worker */
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

/**
 * Creates a fully configured BullMQ worker with:
 * - Job handling and error handling
 * - Cancellation support via AbortSignal
 * - Lock renewal failure handling with integration recovery
 *
 * @param queue The queue to process
 * @param jobMappings Object mapping job names to their handler functions
 * @param workerOptions Worker configuration options
 * @returns A configured BullMQ Worker instance
 */
export function createWorker<T extends Record<string, JobHandler | LegacyJobHandler>>(
  queue: Queues,
  jobMappings: T,
  workerOptions?: EnhancedWorkerOptions
): Worker {
  const { enableCancellation = true, logLevel = 'info', ...bullmqOptions } = workerOptions || {}

  const options: WorkerOptions = {
    connection: getConnectionOptions(),
    ...bullmqOptions,
  }

  const handler = createJobHandler(jobMappings)

  const worker = new Worker(queue, handler, options)

  // Error handling
  worker.on('error', (error: Error) => {
    logger.error(`Worker error on queue ${queue}:`, { error: error.message })
  })

  // Lock renewal failure handling with integration recovery
  worker.on('lockRenewalFailed', async (jobId: string, error: Error) => {
    logger.warn('Lock renewal failed', { jobId, queue, error: error.message })

    // Attempt to recover integration state for polling sync jobs
    try {
      const job = await Job.fromId(worker, jobId)

      if (job?.data?.integrationId) {
        const { integrationId } = job.data

        // Dynamic imports to avoid circular dependencies
        const { recoverProcessingBatch, getImportCacheSize } = await import(
          '@auxx/lib/email/polling-import-cache'
        )
        const { database: db, schema } = await import('@auxx/database')
        const { and, eq, inArray } = await import('drizzle-orm')

        const recovered = await recoverProcessingBatch(integrationId)
        const cacheSize = await getImportCacheSize(integrationId)

        const resetStage = cacheSize > 0 ? 'MESSAGES_IMPORT_PENDING' : 'MESSAGE_LIST_FETCH_PENDING'

        await db
          .update(schema.Integration)
          .set({ syncStage: resetStage, syncStageStartedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.Integration.id, integrationId),
              inArray(schema.Integration.syncStage, ['MESSAGE_LIST_FETCH', 'MESSAGES_IMPORT'])
            )
          )

        logger.info('Recovered integration after lock loss', {
          integrationId,
          recoveredFromProcessing: recovered,
          cacheSize,
          resetStage,
        })
      }
    } catch (err) {
      // Best-effort — stale check will catch it in 15 minutes
      logger.error('Failed to recover integration after lock loss', {
        jobId,
        error: (err as Error).message,
      })
    }
  })

  // Progress logging
  worker.on('progress', (job, progress) => {
    if (logLevel === 'debug') {
      logger.debug('Job progress', { jobId: job.id, jobName: job.name, progress })
    }
  })

  // Completion logging
  worker.on('completed', (job, result) => {
    logger.info('Job completed', {
      jobId: job.id,
      jobName: job.name,
      duration: job.finishedOn ? job.finishedOn - (job.processedOn || 0) : null,
    })
  })

  // Failure logging
  worker.on('failed', (job, error) => {
    logger.error('Job failed', {
      jobId: job?.id,
      jobName: job?.name,
      error: error.message,
      attemptsMade: job?.attemptsMade,
    })
  })

  logger.info(`Worker started for queue: ${queue}`, {
    concurrency: options.concurrency || 1,
  })

  return worker
}
