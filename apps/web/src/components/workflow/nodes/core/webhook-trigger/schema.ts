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
 * Zod schema for the connection webhook trigger node (flattened structure).
 */
export const webhookTriggerNodeDataSchema = baseNodeDataSchema.extend({
  connectionId: z.string().min(1, 'Connection is required'),
  topic: z.string().min(1, 'Topic is required'),
  connectionName: z.string().optional(),
  connectionType: z.string().optional(),
  connectionIcon: z.string().optional(),
})

export const createWebhookTriggerDefaultData = (): Partial<WebhookTriggerNodeData> => ({
  title: 'Connection Webhook',
  desc: 'Select a connection and topic',
  connectionId: '',
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
 * Output variables exposed by the connection webhook trigger: the topic, the
 * connection id, and the raw verified payload (`body`).
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
      description: 'The provider topic that fired this workflow',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'connectionId',
      type: BaseType.STRING,
      description: 'The connection id that received the webhook',
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
 * Connection webhook trigger node definition.
 */
export const webhookTriggerDefinition: NodeDefinition<WebhookTriggerNodeData> = {
  id: NodeType.WEBHOOK_TRIGGER,
  category: NodeCategory.TRIGGER,
  displayName: 'Connection Webhook',
  description: 'Trigger when a connection receives a webhook on a topic',
  icon: 'webhook',
  color: '#10b981', // TRIGGER category color
  schema: webhookTriggerNodeDataSchema,
  defaultData: webhookTriggerDefaultData,
  canRunSingle: false, // Triggers cannot be run individually
  triggerType: WorkflowTriggerType.WEBHOOK_TRIGGER,
  validator: validateWebhookTriggerData,
  outputVariables: getWebhookTriggerOutputVariables as any,
}
