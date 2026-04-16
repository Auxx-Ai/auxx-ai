// packages/lib/src/jobs/recording/transcribe-recording-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { processTranscript } from '../../recording/transcription'

const logger = createScopedLogger('job:transcribe-recording')

export interface TranscribeRecordingJobData {
  recordingId: string
  organizationId: string
}

/**
 * Fetch the transcript from the bot provider and store it in the database.
 * Enqueued when the provider sends a `transcript.done` webhook.
 */
export const transcribeRecordingJob = async (jobOrCtx: Job<TranscribeRecordingJobData>) => {
  const job: Job<TranscribeRecordingJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const { recordingId, organizationId } = job.data

  logger.info('Starting transcription', {
    jobId: job.id,
    recordingId,
    organizationId,
  })

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

  return result.value
}
