// apps/web/src/components/workflow/nodes/core/webhook/schema.ts

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
import { schemaToUnifiedVariable } from '~/components/workflow/utils/schema-to-variable'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import type { WebhookNodeData } from './types'

/**
 * Zod schema for webhook node data (flattened structure)
 */
export const webhookNodeDataSchema = baseNodeDataSchema.extend({
  method: z.enum(['GET', 'POST']).default('POST'),
  bodySchema: z
    .object({ enabled: z.boolean().default(false), schema: z.any().optional() })
    .optional(),
})

/**
 * Create default data for webhook node (flattened structure)
 */
export const createWebhookDefaultData = (): Partial<WebhookNodeData> => ({
  title: 'Webhook Trigger',
  desc: 'Trigger workflow via HTTP webhook',
  method: 'POST',
  bodySchema: { enabled: false, schema: undefined },
})

export const webhookDefaultData = createWebhookDefaultData()

/**
 * Validate webhook node data (flattened structure)
 */
export function validateWebhookData(data: WebhookNodeData): ValidationResult {
  try {
    webhookNodeDataSchema.parse(data)
    return { isValid: true, errors: [] }
  } catch (error) {
    console.error('Webhook validation error:', error)
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
 * Define output variables for webhook node (supports both config and flattened structure)
 */
function getWebhookOutputVariables(data: WebhookNodeData, nodeId: string): UnifiedVariable[] {
  // Support both old config structure and new flattened structure
  // const data = 'config' in configOrData ? configOrData.config : configOrData
  const variables: UnifiedVariable[] = []

  // Method variable
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'method', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'HTTP method of the webhook request (GET or POST)',
    })
  )

  // Headers variable
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'headers', // Changed from 'name' to 'path'
      type: BaseType.OBJECT,
      description: 'HTTP headers from the webhook request',
    })
  )

  // Query parameters
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'query', // Changed from 'name' to 'path'
      type: BaseType.OBJECT,
      description: 'Query parameters from the webhook URL',
    })
  )

  // Body variable (only for POST requests)
  if (data.method === 'POST') {
    // If body schema is defined, use it to generate structured output variables
    if (data.bodySchema?.enabled && data.bodySchema.schema) {
      // schemaToUnifiedVariable now handles nested paths correctly
      const bodyVar = schemaToUnifiedVariable(data.bodySchema.schema, nodeId, 'body')
      bodyVar.description = 'Structured request body based on the defined schema'
      variables.push(bodyVar)
    } else {
      // Otherwise, provide a generic object variable
      variables.push(
        createUnifiedOutputVariable({
          nodeId,
          path: 'body', // Changed from 'name' to 'path'
          type: BaseType.OBJECT,
          description: 'JSON body content from the webhook request',
        })
      )
    }
  }

  return variables
}

/**
 * Webhook node definition
 */
export const webhookDefinition: NodeDefinition<WebhookNodeData> = {
  id: NodeType.WEBHOOK,
  category: NodeCategory.TRIGGER,
  displayName: 'Webhook',
  description: 'Trigger workflow via HTTP webhook',
  icon: 'webhook',
  color: '#10b981', // TRIGGER category color
  schema: webhookNodeDataSchema,
  defaultData: webhookDefaultData,
  canRunSingle: false, // Triggers cannot be run individually
  triggerType: WorkflowTriggerType.WEBHOOK,
  validator: validateWebhookData,
  outputVariables: getWebhookOutputVariables as any,
}
