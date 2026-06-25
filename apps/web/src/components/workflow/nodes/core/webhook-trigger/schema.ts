// apps/web/src/components/workflow/nodes/core/webhook-trigger/schema.ts

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  type ValidationResult,
} from '~/components/workflow/types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import type { WebhookTriggerNodeData } from './types'

/**
 * Zod schema for the webhook endpoint trigger node (flattened structure).
 */
export const webhookTriggerNodeDataSchema = baseNodeDataSchema.extend({
  webhookEndpointId: z.string().min(1, 'Webhook endpoint is required'),
  // Optional — blank matches every delivery (endpoints with no topicSource extract topic '').
  topic: z.string().default(''),
  webhookEndpointName: z.string().optional(),
})

export const createWebhookTriggerDefaultData = (): Partial<WebhookTriggerNodeData> => ({
  title: 'Webhook Endpoint',
  desc: 'Select a webhook endpoint',
  webhookEndpointId: '',
  topic: '',
})

export const webhookTriggerDefaultData = createWebhookTriggerDefaultData()

/**
 * Validate connection webhook trigger node data.
 */
export function validateWebhookTriggerData(data: WebhookTriggerNodeData): ValidationResult {
  try {
    webhookTriggerNodeDataSchema.parse(data)
    return { isValid: true, errors: [] }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
          type: 'error' as const,
        })),
      }
    }
    return {
      isValid: false,
      errors: [{ field: 'general', message: 'Invalid configuration', type: 'error' as const }],
    }
  }
}

/**
 * Output variables exposed by the webhook endpoint trigger: the topic, the
 * endpoint id, and the raw verified payload (`body`).
 */
function getWebhookTriggerOutputVariables(
  _data: WebhookTriggerNodeData,
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
 * Webhook endpoint trigger node definition.
 */
export const webhookTriggerDefinition: NodeDefinition<WebhookTriggerNodeData> = {
  id: NodeType.WEBHOOK_ENDPOINT,
  category: NodeCategory.TRIGGER,
  displayName: 'Webhook Endpoint',
  description: 'Trigger when a webhook endpoint receives a delivery',
  icon: 'webhook',
  color: '#10b981', // TRIGGER category color
  schema: webhookTriggerNodeDataSchema,
  defaultData: webhookTriggerDefaultData,
  canRunSingle: false, // Triggers cannot be run individually
  triggerType: WorkflowTriggerType.WEBHOOK_ENDPOINT,
  validator: validateWebhookTriggerData,
  outputVariables: getWebhookTriggerOutputVariables as any,
}
