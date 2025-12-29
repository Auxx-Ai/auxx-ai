import { Queues } from '@auxx/lib/queues/types'
import * as jobs from '@auxx/lib/jobs/definitions'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  processWebhookJob: jobs.processWebhookJob,
  processSingleWebhookJob: jobs.processSingleWebhookJob,
}

export function startWebhooksWorker() {
  return createWorker(Queues.webhooksQueue, jobMappings)
}
