// apps/worker/src/workers/worker-definitions/email-worker.ts

import { sendEmailJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:email')

const emailJobMappings = {
  sendEmailJob,
}

/**
 * Starts a BullMQ worker for the email delivery queue.
 * Processes all outbound system/transactional emails via @auxx/email senders.
 */
export function startEmailWorker() {
  logger.info(`Starting worker for queue: ${Queues.emailQueue}`)

  return createWorker(Queues.emailQueue, emailJobMappings, {
    concurrency: 5,
  })
}
