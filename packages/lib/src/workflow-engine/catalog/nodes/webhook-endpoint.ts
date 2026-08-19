// packages/lib/src/workflow-engine/catalog/nodes/webhook-endpoint.ts

import { z } from 'zod'
import { BaseType, WorkflowTriggerType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * The webhook-endpoint trigger node's catalog manifest — fires on a verified
 * delivery to an existing org-level inbound `WebhookEndpoint`, optionally
 * scoped to a topic. (The `webhook` node is the other one: the workflow's own
 * ad-hoc inbound URL.)
 *
 * `webhookEndpointId` / `topic` are copied onto the workflow's
 * `triggerWebhookEndpointId` / `triggerTopic` columns at save time — the
 * derivation lives in `catalog/derive-trigger.ts` (`deriveTriggerLinks`), not
 * in the save path.
 */

/**
 * Data interface for the Webhook Endpoint trigger node.
 */
export interface WebhookEndpointNodeData extends BaseNodeData {
  /** Id of the `WebhookEndpoint` whose deliveries fire this workflow. */
  webhookEndpointId: string
  /** Optional topic to scope deliveries (matched against the endpoint's extracted topic). */
  topic: string
  /** Cached endpoint display name (node label + panel only; never read at run time). */
  webhookEndpointName?: string
}

/**
 * Zod schema for the webhook endpoint trigger node (flattened structure).
 *
 * `webhookEndpointId` is NOT `.min(1)` here: a fresh node legitimately carries
 * `''` until the user picks an endpoint, and a manifest's defaults must parse
 * their own `configSchema`. Required-ness lives in {@link
 * validateWebhookEndpointData} instead, with the same field and message.
 */
export const webhookEndpointNodeDataSchema = baseNodeDataSchema.extend({
  webhookEndpointId: z.string().default(''),
  // Optional — blank matches every delivery (endpoints with no topicSource extract topic '').
  topic: z.string().default(''),
  webhookEndpointName: z.string().optional(),
})

/**
 * Validate webhook endpoint trigger node data.
 */
export function validateWebhookEndpointData(data: WebhookEndpointNodeData): NodeValidationResult {
  const parsed = webhookEndpointNodeDataSchema.safeParse(data)
  if (!parsed.success) {
    return {
      isValid: false,
      errors: parsed.error.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
        type: 'error' as const,
      })),
    }
  }

  // An unbound trigger never fires — the save path has no endpoint id to write
  // to `Workflow.triggerWebhookEndpointId`. An ordinary error, not
  // `blocksAuthoring`: a half-configured draft is legitimate and the user
  // finishes it in the panel.
  if (!data.webhookEndpointId) {
    return {
      isValid: false,
      errors: [
        {
          field: 'webhookEndpointId',
          message: 'Webhook endpoint is required',
          type: 'error' as const,
        },
      ],
    }
  }

  return { isValid: true, errors: [] }
}

/**
 * Output variables exposed by the webhook endpoint trigger: the topic, the
 * endpoint id, and the raw verified payload (`body`).
 *
 * `body` is typed OBJECT because that is the overwhelmingly common case, but
 * the processor passes the payload through rather than coercing it — a sender
 * may post an array or a scalar (`nodes/trigger-nodes/webhook-endpoint.ts`).
 */
function getWebhookEndpointOutputVariables(
  _data: WebhookEndpointNodeData,
  nodeId: string
): UnifiedVariable[] {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'topic',
      type: BaseType.STRING,
      description: 'The topic that fired this workflow',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'webhookEndpointId',
      type: BaseType.STRING,
      description: 'The webhook endpoint id that received the delivery',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'body',
      type: BaseType.OBJECT,
      description: 'The verified webhook payload',
    }),
  ]
}

/**
 * Webhook endpoint trigger node manifest.
 */
export const webhookEndpointManifest: NodeManifest<WebhookEndpointNodeData> = {
  id: 'webhook-endpoint',
  category: NodeCategory.TRIGGER,
  displayName: 'Webhook Endpoint',
  description: 'Trigger when a webhook endpoint receives a delivery',
  icon: 'webhook',
  color: '#10b981', // TRIGGER category color
  triggerType: WorkflowTriggerType.WEBHOOK_ENDPOINT,
  defaultData: () => ({
    title: 'Webhook Endpoint',
    desc: 'Select a webhook endpoint',
    webhookEndpointId: '',
    topic: '',
  }),
  configSchema: webhookEndpointNodeDataSchema as unknown as z.ZodType<WebhookEndpointNodeData>,
  validate: validateWebhookEndpointData,
  resolveOutputs: getWebhookEndpointOutputVariables,
  connection: {
    canRunSingle: false, // Triggers cannot be run individually
  },
  agent: {
    authorable: true,
    usage:
      'Fires on a delivery to a webhook endpoint the org has ALREADY created (Settings → ' +
      'Webhooks), not on a URL this workflow owns — for the latter use `webhook`. ' +
      '`webhookEndpointId` is a `WebhookEndpoint` CUID: there is no tool that lists them, so ' +
      'NEVER invent one. Add the node with `webhookEndpointId` left empty and tell the user to ' +
      'pick the endpoint in the node panel; the validator will report it as unconfigured until ' +
      'they do, and the workflow will not fire. `topic` is optional and scopes deliveries — ' +
      'blank matches every delivery. The payload arrives verbatim as `body`.',
    examples: [
      {
        description: 'Bound endpoint, scoped to one topic',
        config: { webhookEndpointId: 'whe_abc123', topic: 'order.created' },
      },
      {
        description: 'Endpoint left for the user to pick in the panel',
        config: { webhookEndpointId: '', topic: '' },
      },
    ],
  },
}
