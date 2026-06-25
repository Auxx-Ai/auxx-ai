// apps/web/src/components/workflow/nodes/core/webhook-trigger/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Data interface for the Webhook Endpoint trigger node. Fires the workflow on a verified
 * delivery to a generic inbound `WebhookEndpoint` (`webhookEndpointId`), optionally scoped
 * to a `topic`. The cached endpoint name keeps the node + panel readable without
 * re-querying. The save path persists `webhookEndpointId`/`topic` to the workflow's
 * `triggerWebhookEndpointId`/`triggerTopic` (see workflow-service `update`).
 */
export interface WebhookTriggerNodeData extends BaseNodeData {
  /** Id of the WebhookEndpoint whose deliveries fire this workflow. */
  webhookEndpointId: string
  /** Optional topic to scope deliveries (matched against the endpoint's extracted topic). */
  topic: string
  /** Cached endpoint display name (for the node label + panel). */
  webhookEndpointName?: string
}

/**
 * Full Webhook Endpoint trigger node type matching React Flow's structure.
 */
export type WebhookTriggerNode = SpecificNode<'webhook-endpoint', WebhookTriggerNodeData>
