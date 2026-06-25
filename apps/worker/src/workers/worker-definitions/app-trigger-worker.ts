// apps/worker/src/workers/worker-definitions/app-trigger-worker.ts

import {
  APP_TRIGGER_SYNC_STREAM_JOB,
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  dispatchAppTriggerToConnectors,
  dispatchWebhookEndpoint,
  dispatchWebhookEndpointToAgents,
  dispatchWebhookEndpointToConnectors,
  runConnectorAppTriggerStream,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  // Sync bridge: third consumer of the app-trigger fan-out + its per-stream child.
  dispatchAppTriggerToConnectors,
  [APP_TRIGGER_SYNC_STREAM_JOB]: runConnectorAppTriggerStream,
  dispatchWebhookEndpoint,
  dispatchWebhookEndpointToAgents,
  // Connector-sink leg of the generic WebhookEndpoint fan-out (reuses the same child).
  dispatchWebhookEndpointToConnectors,
}

export function startAppTriggerWorker() {
  return createWorker(Queues.appTriggerQueue, jobMappings, {
    concurrency: 10,
  })
}
