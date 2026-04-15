// packages/lib/src/jobs/recording/handle-bot-timeout-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { cancelBot, pollBotStatus } from '../../recording/bot'
import type { BotStatus } from '../../recording/bot/types'
import { TERMINAL_STATUSES } from '../../recording/bot/types'
import { findRecording, updateRecording } from '../../recording/recording-queries'

const logger = createScopedLogger('job:bot-timeout')

export interface HandleBotTimeoutJobData {
  recordingId: string
}

/** Statuses that indicate the bot is stuck and should be timed out */
const TIMEOUT_ELIGIBLE_STATUSES: BotStatus[] = ['joining', 'waiting']

/**
 * Delayed job: fire 10 min after bot creation to cancel stuck bots.
 */
export const handleBotTimeoutJob = async (jobOrCtx: Job<HandleBotTimeoutJobData>) => {
  const job: Job<HandleBotTimeoutJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const { recordingId } = job.data

  // First poll to get the latest status from the provider
  await pollBotStatus({ recordingId })

  // Re-read the recording to check current status after poll
  const recording = await findRecording({ id: recordingId }, { skipOrganizationId: true })

  if (!recording) {
    logger.warn('Recording not found for timeout check', { recordingId })
    return
  }

  const status = recording.status as BotStatus

  // Already terminal — nothing to do
  if (TERMINAL_STATUSES.includes(status)) {
    logger.debug('Recording already terminal, skipping timeout', { recordingId, status })
    return
  }

  // Only timeout if stuck in joining/waiting
  if (!TIMEOUT_ELIGIBLE_STATUSES.includes(status)) {
    logger.debug('Recording not in timeout-eligible status', { recordingId, status })
    return
  }

  logger.info('Timing out stuck bot', { recordingId, status })

  const result = await cancelBot({
    recordingId,
    organizationId: recording.organizationId,
  })

  if (result.isErr()) {
    logger.error('Failed to cancel timed-out bot', {
      recordingId,
      error: result.error.message,
    })
    throw result.error
  }

  // Update status to timeout (cancelBot sets it to cancelled, override to timeout)
  await updateRecording(
    { id: recordingId, organizationId: recording.organizationId },
    { status: 'timeout', failureReason: 'Bot timed out waiting to join' }
  )

  logger.info('Bot timed out successfully', { recordingId })
}
