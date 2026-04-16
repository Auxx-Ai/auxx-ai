// packages/lib/src/jobs/recording/process-recording-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { downloadAndStoreRecordingMedia } from '../../recording/bot'
import { enqueueGenerateVideoAssetsJob } from './generate-video-assets-job'

const logger = createScopedLogger('job:process-recording')

export interface ProcessRecordingJobData {
  recordingId: string
  organizationId: string
}

/**
 * Download recording media from the provider and store in S3.
 * Enqueued when the provider sends a `recording.done` webhook.
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

  // Kick off storyboard + preview-thumbnail generation. Best-effort: a failure
  // here shouldn't fail the parent job — the recording is already usable.
  if (result.value.videoAssetId) {
    try {
      await enqueueGenerateVideoAssetsJob({ recordingId, organizationId })
    } catch (error) {
      logger.error('Failed to enqueue generateVideoAssetsJob', {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result.value
}
