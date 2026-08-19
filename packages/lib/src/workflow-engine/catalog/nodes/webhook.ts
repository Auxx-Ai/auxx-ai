// packages/lib/src/workflow-engine/catalog/nodes/webhook.ts

import { z } from 'zod'
import { BaseType, WorkflowTriggerType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { schemaToUnifiedVariable } from '../schema-to-variable'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * The webhook trigger node's catalog manifest — the workflow's own inbound URL
 * (`/api/workflows/:workflowId/webhook`), as opposed to `webhook-endpoint`,
 * which binds an existing org-level `WebhookEndpoint`.
 *
 * `bodySchema.schema` is typed loosely here (`type: string`) so apps/web can
 * narrow it to the schema editor's `SchemaRoot` — whose `type` is a string-enum
 * member, not the literal `'object'` — without a cast. Same treatment as
 * `information-extractor.structured_output.schema`.
 */

/** A JSON Schema as the schema editor persists it. Loose on purpose (see above). */
export interface WebhookBodySchema {
  type: string // always 'object'; string so web's SchemaRoot narrows cleanly
  properties: Record<string, any>
  required?: string[]
  additionalProperties?: boolean | Record<string, any>
}

/**
 * Data interface for the webhook trigger node (flattened structure).
 */
export interface WebhookNodeData extends BaseNodeData {
  method: 'GET' | 'POST'
  /** Declared request-body shape. When enabled, its properties become the node's `body.*` variables. */
  bodySchema?: { enabled: boolean; schema?: WebhookBodySchema }
  /**
   * Declared but NEVER enforced: no panel writes these and the route
   * (`apps/web/src/app/api/workflows/[workflowId]/webhook/route.ts`) does not
   * read them — the production path is deliberately unauthenticated, URL
   * secrecy being the webhook contract. Kept on the type (legacy rows may
   * carry them) and deliberately absent from `configSchema`, so nothing
   * advertises an auth mode the endpoint does not actually apply.
   */
  authType?: 'bearer' | 'apiKey' | 'hmac' | null
  authConfig?: { secret?: string; headerName?: string }
  /** What the endpoint answers with. Read live by the route on both the run and the error path. */
  responseConfig?: {
    statusCode: number
    body?: string
    headers?: Record<string, string>
  }
}

/**
 * Zod schema for webhook node data (flattened structure).
 *
 * `responseConfig` is declared here where the pre-catalog builder schema left
 * it out — the route reads all three of its members at run time, so leaving it
 * undeclared meant the one persisted key with a live consumer was the one key
 * neither the validator nor `describe_node_type` could see.
 */
export const webhookNodeDataSchema = baseNodeDataSchema.extend({
  method: z.enum(['GET', 'POST']).default('POST'),
  bodySchema: z
    .object({ enabled: z.boolean().default(false), schema: z.any().optional() })
    .optional(),
  responseConfig: z
    .object({
      statusCode: z.number(),
      body: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})

/**
 * Validate webhook node data.
 */
export function validateWebhookData(data: WebhookNodeData): NodeValidationResult {
  const parsed = webhookNodeDataSchema.safeParse(data)
  if (parsed.success) {
    return { isValid: true, errors: [] }
  }
  return {
    isValid: false,
    errors: parsed.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      type: 'error' as const,
    })),
  }
}

/**
 * Define output variables for the webhook node.
 *
 * `method` / `headers` / `query` are always advertised; `body` only on POST,
 * and it takes the declared schema's own nested paths when one is set. This
 * matches what `WebhookProcessor` writes (`nodes/trigger-nodes/webhook-processor.ts`).
 */
function getWebhookOutputVariables(data: WebhookNodeData, nodeId: string): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'method',
      type: BaseType.STRING,
      description: 'HTTP method of the webhook request (GET or POST)',
    })
  )

  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'headers',
      type: BaseType.OBJECT,
      description: 'HTTP headers from the webhook request',
    })
  )

  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'query',
      type: BaseType.OBJECT,
      description: 'Query parameters from the webhook URL',
    })
  )

  // Body variable (only for POST requests)
  if (data.method === 'POST') {
    // If body schema is defined, use it to generate structured output variables
    if (data.bodySchema?.enabled && data.bodySchema.schema) {
      // schemaToUnifiedVariable handles nested paths
      const bodyVar = schemaToUnifiedVariable(data.bodySchema.schema, nodeId, 'body')
      bodyVar.description = 'Structured request body based on the defined schema'
      variables.push(bodyVar)
    } else {
      variables.push(
        createUnifiedOutputVariable({
          nodeId,
          path: 'body',
          type: BaseType.OBJECT,
          description: 'JSON body content from the webhook request',
        })
      )
    }
  }

  return variables
}

/**
 * Webhook trigger node manifest.
 */
export const webhookManifest: NodeManifest<WebhookNodeData> = {
  id: 'webhook',
  category: NodeCategory.TRIGGER,
  displayName: 'Webhook',
  description: 'Trigger workflow via HTTP webhook',
  icon: 'webhook',
  color: '#10b981', // TRIGGER category color
  triggerType: WorkflowTriggerType.WEBHOOK,
  defaultData: () => ({
    title: 'Webhook Trigger',
    desc: 'Trigger workflow via HTTP webhook',
    method: 'POST',
    bodySchema: { enabled: false, schema: undefined },
  }),
  configSchema: webhookNodeDataSchema as unknown as z.ZodType<WebhookNodeData>,
  validate: validateWebhookData,
  resolveOutputs: getWebhookOutputVariables,
  connection: {
    canRunSingle: false, // Triggers cannot be run individually
  },
  agent: {
    authorable: true,
    usage:
      'The workflow gets its own inbound URL and starts when something POSTs (or GETs) to it — ' +
      'use this for a generic "call my workflow over HTTP" trigger. The URL is shown in the ' +
      'node panel; the endpoint is unauthenticated by design (URL secrecy is the contract), so ' +
      'never promise the user bearer/HMAC verification. On POST, declare the payload shape in ' +
      "`bodySchema` (`{ enabled: true, schema: <JSON Schema object> }`) and the schema's own " +
      'properties become `body.*` variables downstream; without it `body` is one opaque object. ' +
      'GET advertises no body at all. `responseConfig` sets what the caller gets back ' +
      '(defaults to 200 "OK"). For deliveries from an existing org webhook endpoint, use ' +
      '`webhook-endpoint` instead.',
    examples: [
      {
        description: 'POST webhook with a declared body shape',
        config: {
          method: 'POST',
          bodySchema: {
            enabled: true,
            schema: {
              type: 'object',
              properties: { orderId: { type: 'string' }, total: { type: 'number' } },
              required: ['orderId'],
            },
          },
        },
      },
    ],
  },
}
