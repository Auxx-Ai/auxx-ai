// apps/web/src/components/workflow/nodes/core/find/types.ts
import { generateId } from '@auxx/utils'
import { z } from 'zod'
import type { Condition, ConditionGroup } from '~/components/conditions'
import type { ExecutionResult } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'

/**
 * Node data for find nodes (flattened structure)
 */
export interface FindNodeData extends BaseNodeData {
  // Base node properties (inherited from BaseNodeData)
  id: string
  type: NodeType.FIND
  selected: boolean

  // Node configuration (flattened structure like other nodes)
  title: string
  desc?: string
  description?: string

  // Find-specific configuration
  resourceType: string // Dynamic selection (contact, ticket, entity_vendors, etc.)
  findMode: 'findOne' | 'findMany'
  conditions: Condition[] // For backward compatibility
  conditionGroups: ConditionGroup[] // Primary grouping system

  // Advanced settings
  orderBy?: {
    field: string
    direction: 'asc' | 'desc'
  }
  limit?: number | string // Can be number (constant) or string (variable reference)

  // Field modes for VarEditor (true = constant mode, false = variable mode)
  fieldModes?: Record<string, boolean>

  // Standard node data properties
  isValid?: boolean
  errors?: string[]
  disabled?: boolean
  outputVariables?: string[]
}

/**
 * Zod schema for validation
 */
export const findNodeDataSchema = z.object({
  // Base properties
  id: z.string(),
  type: z.literal(NodeType.FIND),
  selected: z.boolean(),

  // Config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Find configuration
  resourceType: z.string(), // Dynamic resource selection - validated as TableId at runtime
  findMode: z.enum(['findOne', 'findMany']),
  conditions: z.array(
    z.object({
      id: z.string(),
      fieldId: z.union([z.string(), z.array(z.string())]),
      operator: z.string(),
      value: z.any(),
      isConstant: z.boolean(),
      logicalOperator: z.enum(['AND', 'OR']).optional(),
      key: z.string().optional(),
      subConditions: z.array(z.any()).optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      numberVarType: z.enum(['string', 'number']).optional(),
      variableId: z.string().optional(),
    })
  ),
  conditionGroups: z.array(
    z.object({
      id: z.string(),
      conditions: z.array(
        z.object({
          id: z.string(),
          fieldId: z.union([z.string(), z.array(z.string())]),
          operator: z.string(),
          value: z.any(),
          isConstant: z.boolean(),
          logicalOperator: z.enum(['AND', 'OR']).optional(),
          key: z.string().optional(),
          subConditions: z.array(z.any()).optional(),
          metadata: z.record(z.string(), z.any()).optional(),
          numberVarType: z.enum(['string', 'number']).optional(),
          variableId: z.string().optional(),
        })
      ),
      logicalOperator: z.enum(['AND', 'OR']),
      metadata: z.record(z.string(), z.any()).optional(),
      case_id: z.string().optional(), // For if-else compatibility
    })
  ),

  // Advanced settings
  orderBy: z
    .object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  limit: z.union([z.number().min(1).max(1000), z.string()]).optional(), // number for constant, string for variable

  // Field modes for VarEditor
  fieldModes: z.record(z.string(), z.boolean()).optional(),

  // Standard properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Full Find node type for React Flow
 */
export type FindNode = SpecificNode<'find', FindNodeData>

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * Execution result for find nodes
 */
export interface FindExecutionResult extends ExecutionResult {
  outputs: {
    [resourceKey: string]: any | any[] // Single resource for findOne, array for findMany
  }
}

/**
 * Default data creation function
 */
export function createFindNodeDefaultData(): Partial<FindNodeData> {
  return {
    title: 'Find',
    desc: 'Search for records',
    type: NodeType.FIND,
    resourceType: 'contact', // Default to contact
    findMode: 'findMany',
    conditions: [], // Keep for backward compatibility
    conditionGroups: [
      {
        id: generateId(),
        conditions: [],
        logicalOperator: 'OR',
        order: 0,
        metadata: { name: 'Group' },
      },
    ],
    orderBy: undefined,
    limit: 10, // Default limit of 10 records
    fieldModes: {
      limit: true, // Default to constant mode
    },
  }
}
