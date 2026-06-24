// apps/worker/src/workers/worker-definitions/app-trigger-worker.ts

import {
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  dispatchConnectionWebhook,
  dispatchConnectionWebhookToAgents,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  dispatchConnectionWebhook,
  dispatchConnectionWebhookToAgents,
}

export function startAppTriggerWorker() {
  return createWorker(Queues.appTriggerQueue, jobMappings, {
    concurrency: 10,
  })
}
