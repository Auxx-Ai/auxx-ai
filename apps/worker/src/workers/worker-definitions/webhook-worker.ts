import { processSingleWebhookJob, processWebhookJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  processWebhookJob,
  processSingleWebhookJob,
}

export function startWebhooksWorker() {
  return createWorker(Queues.webhooksQueue, jobMappings)
}
