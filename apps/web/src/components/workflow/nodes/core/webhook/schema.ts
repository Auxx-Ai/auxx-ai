// apps/web/src/components/workflow/nodes/core/webhook/schema.ts

import { type NodeManifest, webhookManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { WebhookNodeData } from './types'

// The data half (schema, defaults, validator, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/webhook`). This file
// is the merge site: manifest + the React parts.

/**
 * Webhook node definition
 */
export const webhookDefinition: NodeDefinition<WebhookNodeData> = defineFromManifest(
  webhookManifest as unknown as NodeManifest<WebhookNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export { validateWebhookData, webhookNodeDataSchema } from '@auxx/lib/workflow-engine/client'

/**
 * Create default data for webhook node (flattened structure)
 */
export const createWebhookDefaultData = (): Partial<WebhookNodeData> =>
  webhookManifest.defaultData() as Partial<WebhookNodeData>

export const webhookDefaultData = createWebhookDefaultData()
