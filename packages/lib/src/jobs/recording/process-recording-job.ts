// packages/lib/src/jobs/recording/process-recording-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { downloadAndStoreRecordingMedia } from '../../recording/bot'

const logger = createScopedLogger('job:process-recording')

export interface ProcessRecordingJobData {
  recordingId: string
  organizationId: string
}

/**
 * Download recording media from the provider and store in S3.
 * Enqueued when a bot status transitions to 'completed'.
 */
export const processRecordingJob = async (jobOrCtx: Job<ProcessRecordingJobData>) => {
  const job: Job<ProcessRecordingJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const { recordingId, organizationId } = job.data

  logger.info('Processing recording media', {
    jobId: job.id,
    recordingId,
    organizationId,
  })

  const result = await downloadAndStoreRecordingMedia({
    recordingId,
    organizationId,
  })

  if (result.isErr()) {
    logger.error('Recording media processing failed', {
      jobId: job.id,
      recordingId,
      error: result.error.message,
    })
    throw result.error
  }

  logger.info('Recording media processing completed', {
    jobId: job.id,
    recordingId,
    videoAssetId: result.value.videoAssetId,
    audioAssetId: result.value.audioAssetId,
  })

  // Phase 3 stub: enqueue transcription job here
  // const transcriptionQueue = getQueue(Queues.transcriptionQueue)
  // await transcriptionQueue.add('transcribeRecordingJob', { recordingId, audioAssetId })

  return result.value
}
