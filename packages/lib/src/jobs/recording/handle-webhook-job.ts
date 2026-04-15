// packages/lib/src/jobs/recording/handle-webhook-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { handleBotStatusChange } from '../../recording/bot'
import type { BotStatus, BotWebhookEventType } from '../../recording/bot/types'

const logger = createScopedLogger('job:recording-webhook')

export interface HandleRecordingWebhookJobData {
  externalBotId: string
  type: BotWebhookEventType
  status?: BotStatus
  subCode?: string
  metadata?: Record<string, unknown>
  timestamp: string
}

/**
 * Process an inbound recording webhook event.
 * Idempotent — safe to retry.
 */
export const handleRecordingWebhookJob = async (jobOrCtx: Job<HandleRecordingWebhookJobData>) => {
  const job: Job<HandleRecordingWebhookJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const { externalBotId, type, status, subCode, metadata } = job.data

  logger.info('Processing recording webhook', {
    jobId: job.id,
    externalBotId,
    type,
    status,
  })

  if (type === 'bot.status_change' && status) {
    const result = await handleBotStatusChange({
      externalBotId,
      newStatus: status,
      subCode,
      metadata,
    })

    if (result.isErr()) {
      logger.error('Failed to handle bot status change', {
        jobId: job.id,
        externalBotId,
        error: result.error.message,
      })
      throw result.error
    }

    logger.info('Bot status change processed', {
      jobId: job.id,
      externalBotId,
      newStatus: status,
      recordingId: result.value.id,
    })
  }

  // recording_ready and transcript_ready events are handled in Phase 3
}
