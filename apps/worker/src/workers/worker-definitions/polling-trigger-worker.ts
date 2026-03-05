// apps/worker/src/workers/worker-definitions/polling-trigger-worker.ts

import { executePollingTrigger } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  executePollingTrigger,
}

export function startPollingTriggerWorker() {
  return createWorker(Queues.appPollingTriggerQueue, jobMappings, {
    concurrency: 10,
  })
}
