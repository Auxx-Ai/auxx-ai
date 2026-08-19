// apps/web/src/components/workflow/nodes/core/webhook/types.ts

import type { CatalogWebhookNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'
import type { SchemaRoot } from '~/components/workflow/ui/json-schema-types'

// The data half moved to the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/webhook`). The node data narrows
// `type` to the web NodeType enum and `bodySchema.schema` to the schema
// editor's `SchemaRoot` (the catalog keeps that member loose for exactly this
// reason). `WebhookTestEvent` below is web-only and stays.

/**
 * Represents a webhook test event that is captured and stored for debugging
 */
export interface WebhookTestEvent {
  /** Unique identifier for the event */
  id: string
  /** ISO timestamp when the event was received */
  timestamp: string
  /** HTTP method used for the webhook request */
  method: 'GET' | 'POST'
  /** Request headers */
  headers: Record<string, string>
  /** Query parameters */
  query: Record<string, string>
  /** Request body (for POST requests) */
  body: unknown
  /** HTTP response status code */
  responseStatus?: number
  /** Response time in milliseconds */
  responseTime?: number
}

/**
 * Data interface for the Webhook node (flattened structure)
 */
export interface WebhookNodeData extends CatalogWebhookNodeData {
  type: NodeType
  bodySchema?: { enabled: boolean; schema?: SchemaRoot }
}

/**
 * Full Webhook node type that matches React Flow's actual structure
 * Using SpecificNode helper for proper type expansion on hover
 */
export type WebhookNode = SpecificNode<'webhook', WebhookNodeData>
