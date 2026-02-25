// apps/worker/src/workers/worker-definitions/scheduled-trigger-worker.ts

import { executeScheduledTrigger } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  executeScheduledTrigger,
}

export function startScheduledTriggerWorker() {
  return createWorker(Queues.scheduledTriggerQueue, jobMappings, {
    concurrency: 10, // Allow multiple scheduled triggers to run concurrently
  })
}
