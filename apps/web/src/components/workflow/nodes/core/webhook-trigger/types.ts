// apps/web/src/components/workflow/nodes/core/webhook-trigger/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Data interface for the Connection Webhook trigger node. Fires the workflow on a
 * verified provider webhook delivered to one connection (`connectionId`) for a
 * specific topic (`topic`). The cached connection display fields keep the node + panel
 * readable without re-querying. The save path persists `connectionId`/`topic` to the
 * workflow's `triggerConnectionId`/`triggerTopic` (see workflow-service `update`).
 */
export interface WebhookTriggerNodeData extends BaseNodeData {
  /** Credential id of the connection whose provider webhooks fire this workflow. */
  connectionId: string
  /** Provider topic to subscribe to, e.g. `orders/create` / `customer.created`. */
  topic: string
  /** Cached connection display name (for the node label + panel). */
  connectionName?: string
  /** Cached connection provider key (e.g. `shopify`), for the icon. */
  connectionType?: string
  /** Cached connection icon id. */
  connectionIcon?: string
}

/**
 * Full Connection Webhook trigger node type matching React Flow's structure.
 */
export type WebhookTriggerNode = SpecificNode<'webhook-trigger', WebhookTriggerNodeData>
