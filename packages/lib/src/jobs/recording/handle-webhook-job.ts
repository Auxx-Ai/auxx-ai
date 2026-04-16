// packages/lib/src/jobs/recording/handle-webhook-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { handleBotStatusChange } from '../../recording/bot'
import type { BotStatus, BotWebhookEventType } from '../../recording/bot/types'
import { findRecording } from '../../recording/recording-queries'
import { getQueue, Queues } from '../queues'

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

  switch (type) {
    case 'bot.status_change':
      await onStatusChange(job, { externalBotId, status, subCode, metadata })
      break
    case 'bot.recording_ready':
      await onRecordingReady(job, externalBotId)
      break
    case 'bot.transcript_ready':
      await onTranscriptReady(job, externalBotId)
      break
    default:
      logger.warn('Unhandled webhook event type', { jobId: job.id, type })
  }
}

async function onStatusChange(
  job: Job<HandleRecordingWebhookJobData>,
  params: {
    externalBotId: string
    status?: BotStatus
    subCode?: string
    metadata?: Record<string, unknown>
  }
) {
  const { externalBotId, status, subCode, metadata } = params
  if (!status) return

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

async function onRecordingReady(job: Job<HandleRecordingWebhookJobData>, externalBotId: string) {
  const recording = await findRecording({ externalBotId }, { skipOrganizationId: true })

  if (!recording) {
    logger.error('Recording not found for recording_ready event', { externalBotId })
    return
  }

  const queue = getQueue(Queues.recordingProcessingQueue)
  await queue.add(
    'processRecordingJob',
    { recordingId: recording.id, organizationId: recording.organizationId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
    }
  )

  logger.info('Enqueued recording processing job', {
    jobId: job.id,
    externalBotId,
    recordingId: recording.id,
  })
}

async function onTranscriptReady(job: Job<HandleRecordingWebhookJobData>, externalBotId: string) {
  const recording = await findRecording({ externalBotId }, { skipOrganizationId: true })

  if (!recording) {
    logger.error('Recording not found for transcript_ready event', { externalBotId })
    return
  }

  const queue = getQueue(Queues.recordingProcessingQueue)
  await queue.add(
    'transcribeRecordingJob',
    { recordingId: recording.id, organizationId: recording.organizationId },
    {
      jobId: `transcribe-${recording.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    }
  )

  logger.info('Enqueued transcription job', {
    jobId: job.id,
    externalBotId,
    recordingId: recording.id,
  })
}
