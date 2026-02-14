// apps/web/src/components/workflow/nodes/core/end/schema.ts

import { z } from 'zod'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { BaseType, NodeCategory, type NodeDefinition, type ValidationResult } from '../../../types'
import { NodeType } from '../../../types/node-types'
import { EndPanel } from './panel'
import type { EndNodeData } from './types'

/**
 * Main schema for end node data (simplified structure)
 */
export const endNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().default('End'),
  description: z.string().optional(),
  message: z.string().optional(),
  status: z.enum(['success', 'error']).optional(),
})

/**
 * Default configuration for the End node
 */
export const endDefaultData: Partial<EndNodeData> = {
  title: 'Output',
  description: '',
  message: '',
  status: 'success',
}

/**
 * Extract variables from end node message field
 */
export function extractEndVariables(data: Partial<EndNodeData>): string[] {
  const variableIds = new Set<string>()

  if (data.message && typeof data.message === 'string') {
    extractVarIdsFromString(data.message).forEach((id) => variableIds.add(id))
  }

  return Array.from(variableIds)
}

/**
 * Validates the End node configuration
 */
export const validateEndConfig = (data: EndNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate status if provided
  if (data.status && !['success', 'error'].includes(data.status)) {
    errors.push({ field: 'status', message: 'Invalid status value', type: 'error' })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Define output variables for the end/output node
 */
const getEndOutputVariables = (data: Partial<EndNodeData>, nodeId: string) => {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'message',
      type: BaseType.STRING,
      description: 'The output message',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'status',
      type: BaseType.STRING,
      description: 'The output status (success or error)',
    }),
  ]
}

/**
 * Node definition for the End node
 */
export const endDefinition: NodeDefinition<EndNodeData> = {
  id: NodeType.END,
  category: NodeCategory.ACTION,
  displayName: 'Output',
  description: 'Outputs a message for the manual trigger',
  icon: 'message-circle',
  color: '#10b981', // ACTION category color
  defaultData: endDefaultData,
  schema: endNodeDataSchema,
  panel: EndPanel,
  validator: validateEndConfig,
  canRunSingle: true,
  extractVariables: extractEndVariables,
  outputVariables: getEndOutputVariables as any,
}
