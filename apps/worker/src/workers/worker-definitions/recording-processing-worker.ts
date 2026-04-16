// apps/worker/src/workers/worker-definitions/recording-processing-worker.ts

import {
  aiPostProcessJob,
  GENERATE_VIDEO_ASSETS_JOB_NAME,
  processRecordingJob,
  transcribeRecordingJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { generateVideoAssetsJob } from '../../recording/generate-video-assets'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:recording-processing')

const recordingProcessingJobMappings = {
  processRecordingJob,
  transcribeRecordingJob,
  aiPostProcessJob,
  [GENERATE_VIDEO_ASSETS_JOB_NAME]: generateVideoAssetsJob,
}

/**
 * Start the BullMQ worker for recording media processing jobs.
 * Lower concurrency — media downloads are heavy.
 */
export function startRecordingProcessingWorker() {
  logger.info(`Starting worker for queue: ${Queues.recordingProcessingQueue}`)

  return createWorker(Queues.recordingProcessingQueue, recordingProcessingJobMappings, {
    concurrency: 3,
  })
}
