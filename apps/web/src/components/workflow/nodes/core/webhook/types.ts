// apps/web/src/components/workflow/nodes/core/webhook/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'
import type { SchemaRoot } from '~/components/workflow/ui/structured-output-generator/types'

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
export interface WebhookNodeData extends BaseNodeData {
  // Webhook-specific fields (previously in config)
  method: 'GET' | 'POST'
  bodySchema?: { enabled: boolean; schema?: SchemaRoot }
  authType?: 'bearer' | 'apiKey' | 'hmac' | null
  authConfig?: { secret?: string; headerName?: string }
  responseConfig?: {
    statusCode: number
    body?: string // Can include variables
    headers?: Record<string, string>
  }
}

/**
 * Full Webhook node type that matches React Flow's actual structure
 * Using SpecificNode helper for proper type expansion on hover
 */
export type WebhookNode = SpecificNode<'webhook', WebhookNodeData>
