// apps/worker/src/workers/worker-definitions/message-processing-worker.ts

import { sendScheduledMessageJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:message-processing')

const messageProcessingJobMappings = {
  sendScheduledMessageJob,
}

/**
 * Starts a BullMQ worker for the message processing queue.
 * Handles scheduled message sends and future message-related jobs.
 */
export function startMessageProcessingWorker() {
  logger.info(`Starting worker for queue: ${Queues.messageProcessingQueue}`)

  return createWorker(Queues.messageProcessingQueue, messageProcessingJobMappings)
}
