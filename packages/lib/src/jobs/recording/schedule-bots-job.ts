// packages/lib/src/jobs/recording/schedule-bots-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { scheduleBotsForUpcomingMeetings } from '../../recording/bot'

const logger = createScopedLogger('job:schedule-bots')

export interface ScheduleBotsJobData {
  dryRun?: boolean
}

/**
 * Cron job (every 2 min): scan for upcoming meetings and auto-schedule recording bots.
 */
export const scheduleBotsForUpcomingMeetingsJob = async (jobOrCtx: Job<ScheduleBotsJobData>) => {
  const job: Job<ScheduleBotsJobData> = (jobOrCtx as any).job ?? jobOrCtx

  logger.info('Starting bot scheduling scan', { jobId: job.id })

  const result = await scheduleBotsForUpcomingMeetings()

  if (result.isErr()) {
    logger.error('Bot scheduling scan failed', {
      jobId: job.id,
      error: result.error.message,
    })
    throw result.error
  }

  logger.info('Bot scheduling scan completed', {
    jobId: job.id,
    scheduled: result.value.scheduled,
    skipped: result.value.skipped,
  })

  return result.value
}
