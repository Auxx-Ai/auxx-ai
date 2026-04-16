// packages/lib/src/jobs/recording/generate-video-assets-job.ts
//
// Producer-only module. Defines the job name, the data shape, and an enqueue helper
// for the storyboard / preview-thumbnail job. The handler itself lives in apps/worker
// so that fluent-ffmpeg never gets resolved from packages/lib (which is consumed by
// Next.js, Lambda, and API bundles via the @auxx/lib/jobs barrel).

import { getQueue, Queues } from '../queues'

export const GENERATE_VIDEO_ASSETS_JOB_NAME = 'generateVideoAssetsJob' as const

export interface GenerateVideoAssetsJobData {
  recordingId: string
  organizationId: string
}

/**
 * Enqueue storyboard + preview-thumbnail generation for a recording's video.
 * Run on the recording-processing queue (handler registered in apps/worker).
 */
export async function enqueueGenerateVideoAssetsJob(
  data: GenerateVideoAssetsJobData
): Promise<void> {
  const queue = getQueue(Queues.recordingProcessingQueue)
  await queue.add(GENERATE_VIDEO_ASSETS_JOB_NAME, data, {
    jobId: `generate-video-assets-${data.recordingId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  })
}
