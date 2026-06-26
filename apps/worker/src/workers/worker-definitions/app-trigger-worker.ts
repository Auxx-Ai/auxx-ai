// apps/worker/src/workers/worker-definitions/app-trigger-worker.ts

import {
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  dispatchAppTriggerToConnectors,
  dispatchWebhookEndpoint,
  dispatchWebhookEndpointToAgents,
  dispatchWebhookEndpointToConnectors,
  runConnectorWebhookSteer,
  WEBHOOK_STEER_JOB,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  dispatchAppTrigger,
  dispatchAppTriggerToAgents,
  // Sync bridge: third consumer of the app-trigger fan-out. The dispatch routes each matched
  // stream to either the steer job (steerable → targeted partial run) or a full sync.
  dispatchAppTriggerToConnectors,
  dispatchWebhookEndpoint,
  dispatchWebhookEndpointToAgents,
  // Connector-sink leg of the generic WebhookEndpoint fan-out.
  dispatchWebhookEndpointToConnectors,
  // Per-stream child: steers the connector fetch with a webhook payload → targeted PARTIAL run.
  [WEBHOOK_STEER_JOB]: runConnectorWebhookSteer,
}

export function startAppTriggerWorker() {
  return createWorker(Queues.appTriggerQueue, jobMappings, {
    concurrency: 10,
  })
}
