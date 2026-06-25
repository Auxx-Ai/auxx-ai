// packages/lib/src/jobs/recording/schedule-bots-job.ts

import { createScopedLogger } from '@auxx/logger'
import { scheduleBotsForUpcomingMeetings } from '../../recording/bot'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:schedule-bots')

export interface ScheduleBotsJobData {
  dryRun?: boolean
}

/**
 * Cron job (every 2 min): scan for upcoming meetings and auto-schedule recording bots.
 */
export const scheduleBotsForUpcomingMeetingsJob = async (ctx: JobContext<ScheduleBotsJobData>) => {
  const job = ctx.job

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
