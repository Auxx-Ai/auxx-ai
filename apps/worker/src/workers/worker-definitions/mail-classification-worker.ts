// apps/worker/src/workers/worker-definitions/mail-classification-worker.ts

import { mailClassificationJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:mail-classification')

// The key MUST equal `MAIL_CLASSIFICATION_JOB_NAME` — `enqueueMailClassification`
// adds the job under that name and `createJobHandler` dispatches on it.
const mailClassificationJobMappings = {
  mailClassificationJob,
}

/**
 * Starts a BullMQ worker for inbound-mail AI categorisation
 * (plans/mail-filter/05-mail-classification-plan.md §4).
 *
 * Its OWN queue, deliberately: the model call cannot run in the
 * `message:received` gate (2s timeout on the shared `eventsQueue`) and must not
 * hold `eventHandlersQueue` slots for seconds at a time. Concurrency is modest —
 * every job is one metered LLM call against the org's default model.
 */
export function startMailClassificationWorker() {
  logger.info(`Starting worker for queue: ${Queues.mailClassificationQueue}`)

  return createWorker(Queues.mailClassificationQueue, mailClassificationJobMappings, {
    concurrency: 5,
  })
}
