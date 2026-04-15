// apps/worker/src/workers/worker-definitions/recording-bot-worker.ts

import {
  handleBotTimeoutJob,
  handleRecordingWebhookJob,
  pollActiveBotsJob,
  scheduleBotsForUpcomingMeetingsJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:recording-bot')

const recordingBotJobMappings = {
  scheduleBotsForUpcomingMeetingsJob,
  handleRecordingWebhookJob,
  pollActiveBotsJob,
  handleBotTimeoutJob,
}

/**
 * Start the BullMQ worker for recording bot lifecycle jobs.
 */
export function startRecordingBotWorker() {
  logger.info(`Starting worker for queue: ${Queues.recordingBotQueue}`)

  return createWorker(Queues.recordingBotQueue, recordingBotJobMappings, {
    concurrency: 10,
  })
}
