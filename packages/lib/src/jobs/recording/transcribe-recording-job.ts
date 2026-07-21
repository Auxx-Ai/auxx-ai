// packages/lib/src/jobs/recording/transcribe-recording-job.ts

import { createScopedLogger } from '@auxx/logger'
import { UnrecoverableError } from 'bullmq'
import type { BotStatus } from '../../recording/bot/types'
import { FAILURE_TERMINAL_STATUSES } from '../../recording/bot/types'
import { findRecording } from '../../recording/recording-queries'
import { processTranscript } from '../../recording/transcription'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'
import type { AIPostProcessJobData } from './ai-post-process-job'

const logger = createScopedLogger('job:transcribe-recording')

export interface TranscribeRecordingJobData {
  recordingId: string
  organizationId: string
}

/**
 * Fetch the transcript from the bot provider and store it in the database.
 * Enqueued when the provider sends a `transcript.done` webhook.
 */
export const transcribeRecordingJob = async (ctx: JobContext<TranscribeRecordingJobData>) => {
  const job = ctx.job
  const { recordingId, organizationId } = job.data

  logger.info('Starting transcription', {
    jobId: job.id,
    recordingId,
    organizationId,
  })

  // A bot that never recorded has no transcript to fetch — retrying won't help.
  const recording = await findRecording({ id: recordingId, organizationId })
  if (recording && FAILURE_TERMINAL_STATUSES.includes(recording.status as BotStatus)) {
    throw new UnrecoverableError(
      `Recording ${recordingId} ended without a recording (status: ${recording.status}) — no transcript to fetch`
    )
  }

  const result = await processTranscript({ recordingId, organizationId })

  if (result.isErr()) {
    logger.error('Transcription failed', {
      jobId: job.id,
      recordingId,
      error: result.error.message,
    })
    throw result.error
  }

  logger.info('Transcription completed', {
    jobId: job.id,
    recordingId,
    transcriptId: result.value.transcriptId,
  })

  // Chain: kick off AI post-processing once the transcript is stored.
  const queue = getQueue(Queues.recordingProcessingQueue)
  const postProcessData: AIPostProcessJobData = {
    recordingId,
    organizationId,
    trigger: 'transcript.completed',
  }
  await queue.add('aiPostProcessJob', postProcessData, {
    jobId: `ai-post-process-${recordingId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  })

  return result.value
}
