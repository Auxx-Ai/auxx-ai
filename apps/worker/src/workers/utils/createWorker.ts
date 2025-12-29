// apps/worker/src/workers/utils/createWorker.ts

import { Worker, type WorkerOptions } from 'bullmq'
import { Queues } from '@auxx/lib/queues/types'
import { createJobHandler } from './createJobHandler'
import { getConnectionOptions } from '@auxx/redis'
import { createScopedLogger } from '@auxx/logger'
import type { JobHandler, LegacyJobHandler } from '@auxx/lib/jobs'

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
 * - Lock renewal failure handling
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

  // Lock renewal failure handling (cancel jobs that lost their lock)
  worker.on('lockRenewalFailed', (jobId: string, error: Error) => {
    logger.warn('Lock renewal failed, cancelling job', { jobId, queue, error: error.message })
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
