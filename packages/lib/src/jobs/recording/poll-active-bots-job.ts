// packages/lib/src/jobs/recording/poll-active-bots-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { pollBotStatus } from '../../recording/bot'
import { findRecording } from '../../recording/recording-queries'

const logger = createScopedLogger('job:poll-active-bots')

export interface PollActiveBotsJobData {
  dryRun?: boolean
}

/** Active (non-terminal) statuses worth polling */
const ACTIVE_STATUSES = ['joining', 'waiting', 'admitted', 'recording'] as const

/**
 * Cron job (every 1 min): poll active bot statuses as a safety net for missed webhooks.
 */
export const pollActiveBotsJob = async (jobOrCtx: Job<PollActiveBotsJobData>) => {
  const job: Job<PollActiveBotsJobData> = (jobOrCtx as any).job ?? jobOrCtx

  const activeRecordings = await findRecording(
    { status: [...ACTIVE_STATUSES] },
    { skipOrganizationId: true, multi: true }
  )

  if (activeRecordings.length === 0) {
    return { polled: 0 }
  }

  logger.info('Polling active bots', { jobId: job.id, count: activeRecordings.length })

  let polled = 0
  let errors = 0

  for (const recording of activeRecordings) {
    const result = await pollBotStatus({ recordingId: recording.id })
    if (result.isOk()) {
      polled++
    } else {
      errors++
      logger.warn('Poll failed for recording', {
        recordingId: recording.id,
        error: result.error.message,
      })
    }
  }

  logger.info('Active bot polling completed', {
    jobId: job.id,
    polled,
    errors,
  })

  return { polled, errors }
}
