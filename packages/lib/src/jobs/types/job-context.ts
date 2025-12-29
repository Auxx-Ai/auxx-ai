// packages/lib/src/jobs/types/job-context.ts

import type { Job } from 'bullmq'

/**
 * Enhanced job context passed to all job handlers
 * Provides unified access to job data, cancellation signal, and utilities
 */
export interface JobContext<T = any> {
  /** The BullMQ job instance */
  job: Job<T>

  /** Abort signal for cancellation support */
  signal?: AbortSignal

  /** Job data (shorthand for job.data) */
  data: T

  /** Job ID */
  jobId: string

  /** Job name */
  jobName: string

  /** Update job progress (0-100) */
  updateProgress: (progress: number) => Promise<void>

  /** Log message (will be stored in job logs) */
  log: (message: string) => Promise<void>

  /** Check if job was cancelled */
  isCancelled: () => boolean

  /** Throw if cancelled (for early exit) */
  throwIfCancelled: () => void

  /** Get values from completed child jobs (for flow parents) */
  getChildrenValues: () => Promise<Record<string, any>>

  /** Check if this job has dependencies (is a parent in a flow) */
  hasChildren: () => Promise<boolean>
}

/**
 * Type for job handler functions using the new context pattern
 */
export type JobHandler<T = any, R = any> = (ctx: JobContext<T>) => Promise<R>

/**
 * Type for legacy job handlers (just receive Job)
 */
export type LegacyJobHandler<T = any, R = any> = (job: Job<T>) => Promise<R>
