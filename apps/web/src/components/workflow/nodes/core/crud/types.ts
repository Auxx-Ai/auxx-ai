// apps/web/src/components/workflow/nodes/core/crud/types.ts

import { z } from 'zod'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'
import type { TargetBranch } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * CRUD error strategy enum
 */
export enum CrudErrorStrategy {
  fail = 'fail',
  continue = 'continue',
  default = 'default',
}

/**
 * CRUD default value configuration
 */
export interface CrudDefaultValue {
  key: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value: string // String representation that will be parsed based on type
}

/**
 * CRUD node data interface
 */
export interface CrudNodeData extends BaseNodeData {
  id: string
  type: NodeType.CRUD
  selected: boolean

  // Node configuration
  title: string
  desc?: string
  description?: string

  // CRUD-specific configuration
  resourceType: string // Now accepts system ('contact', 'ticket') and custom ('entity_vendors') resources
  mode: 'create' | 'update' | 'delete'
  resourceId?: string // For update/delete operations (VarEditor input)
  data: Record<string, any> // Field values
  fieldModes?: Record<string, boolean> // Track constant/variable mode per field

  // Error handling configuration
  error_strategy: CrudErrorStrategy
  default_values: CrudDefaultValue[]
  _targetBranches?: TargetBranch[]

  // Standard node properties
  isValid?: boolean
  errors?: string[]
  disabled?: boolean
  outputVariables?: string[]
}

/**
 * Zod schema for CRUD node data validation
 */
export const crudNodeDataSchema = z.object({
  id: z.string(),
  type: z.literal(NodeType.CRUD),
  selected: z.boolean(),
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),
  resourceType: z.string().min(1),
  mode: z.enum(['create', 'update', 'delete']),
  resourceId: z.string().optional(),
  data: z.record(z.string(), z.any()),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
  error_strategy: z.enum(CrudErrorStrategy).default(CrudErrorStrategy.fail),
  default_values: z
    .array(
      z.object({
        key: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
        value: z.string(),
      })
    )
    .default([]),
  _targetBranches: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
      })
    )
    .optional(),
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Specific CRUD node type
 */
export type CrudNode = SpecificNode<'crud', CrudNodeData>

/**
 * Create default CRUD node data
 */
export function createCrudNodeDefaultData(): Partial<CrudNodeData> {
  return {
    title: 'CRUD Operation',
    desc: 'Create, update, or delete records',
    type: NodeType.CRUD,
    resourceType: 'contact',
    mode: 'create',
    data: {},
    error_strategy: CrudErrorStrategy.fail,
    default_values: [],
  }
}
