// packages/lib/src/workflow-engine/catalog/nodes/end.ts

import { z } from 'zod'
import { BaseType } from '../../core/types'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'
import { extractVarIdsFromString } from '../variable-inference'

/**
 * Node data structure for the End node with minimal configuration
 */
export interface EndNodeData extends BaseNodeData {
  /** Optional message to display when workflow ends */
  message?: string
  /** Optional status to set when workflow ends */
  status?: 'success' | 'error'
}

/**
 * Main schema for end node data (simplified structure)
 */
export const endNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().default('End'),
  message: z.string().optional(),
  status: z.enum(['success', 'error']).optional(),
})

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
export const validateEndConfig = (data: EndNodeData): NodeValidationResult => {
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
const getEndOutputVariables = (_data: Partial<EndNodeData>, nodeId: string) => {
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
 * End node manifest
 */
export const endManifest: NodeManifest<EndNodeData> = {
  id: 'end',
  category: NodeCategory.ACTION,
  displayName: 'Output',
  description: 'Outputs a message for the manual trigger',
  icon: 'message-circle',
  color: '#10b981', // ACTION category color
  defaultData: () => ({
    title: 'Output',
    message: '',
    status: 'success',
  }),
  configSchema: endNodeDataSchema as unknown as z.ZodType<EndNodeData>,
  validate: validateEndConfig,
  extractVariables: extractEndVariables,
  resolveOutputs: getEndOutputVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Terminal output node. `message` supports {{…}} variable references; ' +
      '`status` is "success" or "error".',
    examples: [
      {
        description: 'Finish with a templated message',
        config: { message: 'Handled ticket {{find-1.ticket.subject}}', status: 'success' },
      },
    ],
  },
}
