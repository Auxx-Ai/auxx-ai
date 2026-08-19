// apps/web/src/components/workflow/nodes/core/webhook-trigger/types.ts

import type { CatalogWebhookEndpointNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/webhook-endpoint`); this narrows
// `type` to the web `NodeType` enum.

/**
 * Data interface for the Webhook Endpoint trigger node. Fires the workflow on a verified
 * delivery to a generic inbound `WebhookEndpoint` (`webhookEndpointId`), optionally scoped
 * to a `topic`. The cached endpoint name keeps the node + panel readable without
 * re-querying. The save path persists `webhookEndpointId`/`topic` to the workflow's
 * `triggerWebhookEndpointId`/`triggerTopic` (see `deriveTriggerLinks`).
 */
export interface WebhookTriggerNodeData extends CatalogWebhookEndpointNodeData {
  type: NodeType
}

/**
 * Full Webhook Endpoint trigger node type matching React Flow's structure.
 */
export type WebhookTriggerNode = SpecificNode<'webhook-endpoint', WebhookTriggerNodeData>
