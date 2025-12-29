// apps/web/src/components/workflow/nodes/core/resource-trigger/types.ts
import { z } from 'zod'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'
import type { ExecutionResult } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'

/**
 * Node data for resource trigger nodes (flattened structure)
 */
export interface ResourceTriggerData extends BaseNodeData {
  // Base node properties (inherited from BaseNodeData)
  id: string
  type: NodeType.RESOURCE_TRIGGER
  selected: boolean

  // Resource trigger configuration
  resourceType: string // Resource ID (e.g., 'contact', 'ticket', 'entity_vendors')
  operation: 'created' | 'updated' | 'deleted' | 'manual'

  // Node configuration (flattened structure like other nodes)
  title: string
  desc?: string
  description?: string
  variables?: any[]

  // Future extensibility - filters could be added here later
  // filters?: ResourceFilter[]

  // Standard node data properties
  isValid?: boolean
  errors?: string[]
  disabled?: boolean
  outputVariables?: string[]
}

/**
 * Zod schema for validation
 */
export const resourceTriggerNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal(NodeType.RESOURCE_TRIGGER),
  selected: z.boolean(),

  // Resource trigger configuration
  resourceType: z.string().min(1, 'Resource type is required'),
  operation: z.enum(['created', 'updated', 'deleted', 'manual']),

  // Flattened config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),
  variables: z.array(z.any()).optional(),

  // Standard properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Full Resource Trigger node type for React Flow
 */
export type ResourceTriggerNode = SpecificNode<NodeType.RESOURCE_TRIGGER, ResourceTriggerData>

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * Execution result for resource trigger nodes
 */
export interface ResourceTriggerExecutionResult extends ExecutionResult {
  outputs: {
    [resourceKey: string]: any // Dynamic based on resource type (contact, ticket, etc.)
    trigger: {
      timestamp: string
      operation: string
      changedFields?: string[] // For 'updated' operations
      previousValues?: Record<string, any> // For 'updated' operations
      deletedBy?: {
        id: string
        name: string
        email: string
      } // For 'deleted' operations
    }
  }
}
