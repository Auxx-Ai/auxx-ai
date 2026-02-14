// apps/worker/src/workers/utils/createJobHandler.ts

import type { JobContext, JobHandler, LegacyJobHandler } from '@auxx/lib/jobs'
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
      const deps = await job.getDependenciesCount()
      return deps.unprocessed > 0 || deps.processed > 0
    },
  }
}

/**
 * Creates a job handler function for a BullMQ worker with cancellation support
 *
 * @param jobMappings Object mapping job names to their handler functions
 * @returns A function that processes jobs based on the provided mappings
 */
export function createJobHandler<T extends Record<string, JobHandler | LegacyJobHandler>>(
  jobMappings: T
) {
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
      // Create context and call handler
      const ctx = createJobContext(job, signal)
      return await jobFunction(ctx as any)
    } catch (error) {
      if (error instanceof JobCancelledError) {
        logger.info('Job cancelled gracefully', { jobId: job.id, jobName })
        throw error // Let BullMQ handle it (won't retry due to UnrecoverableError)
      }

      logger.error(`Error processing job ${jobName}:`, {
        error: error instanceof Error ? error.message : error,
        jobId: job.id,
      })
      throw error
    }
  }
}
