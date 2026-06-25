// apps/worker/src/workers/worker-definitions/app-trigger-worker.ts

import {
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  dispatchAppTriggerToConnectors,
  dispatchWebhookEndpoint,
  dispatchWebhookEndpointToAgents,
  dispatchWebhookEndpointToConnectors,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  // Sync bridge: third consumer of the app-trigger fan-out. A relevant delivery steers a
  // full run-based sync (enqueueConnectorSync), so there's no per-stream child job.
  dispatchAppTriggerToConnectors,
  dispatchWebhookEndpoint,
  dispatchWebhookEndpointToAgents,
  // Connector-sink leg of the generic WebhookEndpoint fan-out.
  dispatchWebhookEndpointToConnectors,
}

export function startAppTriggerWorker() {
  return createWorker(Queues.appTriggerQueue, jobMappings, {
    concurrency: 10,
  })
}
