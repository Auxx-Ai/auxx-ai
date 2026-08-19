// apps/web/src/components/workflow/nodes/core/webhook-trigger/schema.ts

import { type NodeManifest, webhookEndpointManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { WebhookTriggerNodeData } from './types'

// The data half (schema, defaults, validator, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/webhook-endpoint`).
// This file is the merge site: manifest + the React parts.

/**
 * Webhook endpoint trigger node definition.
 */
export const webhookTriggerDefinition: NodeDefinition<WebhookTriggerNodeData> = defineFromManifest(
  webhookEndpointManifest as unknown as NodeManifest<WebhookTriggerNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns. The catalog names them
// after the node type (`webhook-endpoint`); the historical web names are kept
// as aliases.
export {
  validateWebhookEndpointData as validateWebhookTriggerData,
  webhookEndpointNodeDataSchema as webhookTriggerNodeDataSchema,
} from '@auxx/lib/workflow-engine/client'

export const createWebhookTriggerDefaultData = (): Partial<WebhookTriggerNodeData> =>
  webhookEndpointManifest.defaultData() as Partial<WebhookTriggerNodeData>

export const webhookTriggerDefaultData = createWebhookTriggerDefaultData()
