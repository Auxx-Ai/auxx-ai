// apps/worker/src/workers/utils/createJobHandler.ts

import type { JobContext, JobHandler } from '@auxx/lib/jobs'
import { createScopedLogger } from '@auxx/logger'
import { type Job, UnrecoverableError } from 'bullmq'

const logger = createScopedLogger('job-handler')

/**
 * Cancelled error class for graceful cancellation
 * Extends UnrecoverableError so BullMQ won't retry
 */
export class JobCancelledError extends UnrecoverableError {
  constructor(reason?: string) {
    super(`Job cancelled: ${reason || 'No reason provided'}`)
    this.name = 'JobCancelledError'
  }
}

/**
 * Create job context from BullMQ job and signal
 */
function createJobContext<T>(job: Job<T>, signal?: AbortSignal): JobContext<T> {
  return {
    job,
    signal,
    data: job.data,
    jobId: job.id || 'unknown',
    jobName: job.name,

    updateProgress: async (progress: number) => {
      await job.updateProgress(progress)
    },

    log: async (message: string) => {
      await job.log(message)
    },

    isCancelled: () => signal?.aborted ?? false,

    throwIfCancelled: () => {
      if (signal?.aborted) {
        throw new JobCancelledError(signal.reason)
      }
    },

    getChildrenValues: async () => {
      return await job.getChildrenValues()
    },

    hasChildren: async () => {
      const deps = await job.getDependenciesCount({ processed: true, unprocessed: true })
      return (deps.unprocessed ?? 0) > 0 || (deps.processed ?? 0) > 0
    },
  }
}

/**
 * Creates a job handler function for a BullMQ worker with cancellation support
 *
 * @param jobMappings Object mapping job names to their handler functions
 * @returns A function that processes jobs based on the provided mappings
 */
export function createJobHandler<T extends Record<string, JobHandler>>(jobMappings: T) {
  return async (job: Job, token?: string, signal?: AbortSignal) => {
    const jobName = job.name
    const jobFunction = jobMappings[jobName as keyof T]

    if (!jobFunction) {
      throw new Error(`Job function not found: ${jobName}`)
    }

    // Set up cancellation listener
    if (signal) {
      signal.addEventListener('abort', () => {
        logger.info('Job cancellation requested', {
          jobId: job.id,
          jobName,
          reason: signal.reason,
        })
      })
    }

    try {
      // Create context and call handler. Every handler is a JobHandler that takes a
      // JobContext; native job fields are read via ctx.job.
      const ctx = createJobContext(job, signal)
      return await jobFunction(ctx)
    } catch (error) {
      if (error instanceof JobCancelledError) {
        logger.info('Job cancelled gracefully', { jobId: job.id, jobName })
        throw error // Let BullMQ handle it (won't retry due to UnrecoverableError)
      }

      // An expected retry (e.g. a connector still claimed) is only an error on the last attempt.
      if (isPendingRetry(error, job, job.attemptsMade + 1)) {
        logger.info(`Job ${jobName} will retry`, { jobId: job.id, reason: String(error) })
        throw error
      }

      logger.error(`Error processing job ${jobName}:`, {
        error: error instanceof Error ? error.message : error,
        cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
        jobId: job.id,
      })
      throw error
    }
  }
}

/** Whether `error` asked to be retried quietly and the job still has attempts after `attemptsMade`. */
export function isPendingRetry(
  error: unknown,
  job: Job | undefined,
  attemptsMade: number
): boolean {
  const expected = (error as { expectedRetry?: unknown } | null)?.expectedRetry === true
  return expected && !!job && attemptsMade < (job.opts.attempts ?? 1)
}
