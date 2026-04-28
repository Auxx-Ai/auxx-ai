// packages/lib/src/jobs/tasks/task-deadline-scanner-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { scanAndFireTaskDeadlines } from '../../tasks/scan-and-fire.service'

const logger = createScopedLogger('job:task-deadline-scanner')

export interface TaskDeadlineScannerJobData {
  /**
   * Optional override for tests / startup catch-up runs. Scanner uses `now()`
   * as the comparison point; pass an explicit value to backfill missed
   * deadlines after a long worker outage.
   */
  asOf?: string
}

/**
 * Scheduled every minute via BullMQ `upsertJobScheduler`. Idempotent — a task
 * with `firedAt` set is skipped, so a missed tick or duplicate run is safe.
 */
export const taskDeadlineScannerJob = async (job: Job<TaskDeadlineScannerJobData>) => {
  const asOf = job.data?.asOf ? new Date(job.data.asOf) : new Date()

  logger.debug('Task deadline scan starting', { jobId: job.id, asOf: asOf.toISOString() })

  const result = await scanAndFireTaskDeadlines({ now: asOf })

  if (result.fired > 0) {
    logger.info('Task deadline scan complete', {
      jobId: job.id,
      scanned: result.scanned,
      fired: result.fired,
      notificationsSent: result.notificationsSent,
    })
  }

  return result
}
