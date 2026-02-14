// apps/web/src/components/workflow/nodes/core/loop/schema.ts

import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  type ValidationResult,
} from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { LOOP_CONSTANTS } from './constants'
import { LoopPanel } from './panel'
import type { LoopNodeData } from './types'

/**
 * Zod schema for loop configuration
 */
export const loopConfigSchema = z.object({
  title: z.string().default('Loop'),
  desc: z.string().optional(),
  itemsSource: z.string().min(1, 'Items source is required'),
  iteratorName: z.string().optional().default(LOOP_CONSTANTS.DEFAULT_ITERATOR_NAME), // @deprecated - always 'item' now
  maxIterations: z
    .number()
    .min(1, 'Must have at least 1 iteration')
    .max(
      LOOP_CONSTANTS.ABSOLUTE_MAX_ITERATIONS,
      `Cannot exceed ${LOOP_CONSTANTS.ABSOLUTE_MAX_ITERATIONS} iterations`
    )
    .default(LOOP_CONSTANTS.DEFAULT_MAX_ITERATIONS),
  accumulateResults: z.boolean().default(true),
})

/**
 * Factory function to create default data (flattened structure)
 */
export const createLoopDefaultData = (): Partial<LoopNodeData> => ({
  title: 'Loop',
  description: 'Iterate over each item in a list',
  itemsSource: '',
  // iteratorName is deprecated - always 'item' now
  maxIterations: LOOP_CONSTANTS.DEFAULT_MAX_ITERATIONS,
  accumulateResults: true,
})

/**
 * Default data for new loop nodes
 */
export const loopDefaultData: Partial<LoopNodeData> = createLoopDefaultData()

/**
 * Validation function for loop data
 */
export function validateLoop(data: Partial<LoopNodeData>): ValidationResult {
  try {
    loopConfigSchema.parse(data)

    const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

    // Additional validation
    if (data.itemsSource && !data.itemsSource.trim()) {
      errors.push({ field: 'itemsSource', message: 'Items source cannot be empty', type: 'error' })
    }

    // Add warning for high iteration counts
    if (data.maxIterations && data.maxIterations > 1000) {
      errors.push({
        field: 'maxIterations',
        message:
          'High iteration count (>1000) may impact performance. Consider pagination or batch processing.',
        type: 'warning',
      })
    }

    // Iterator name validation removed - always 'item' now

    if (errors.filter((e) => e.type === 'error').length > 0) {
      return { isValid: false, errors }
    }

    return { isValid: true, errors }
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
      errors: [{ field: 'general', message: 'Invalid configuration', type: 'error' }],
    }
  }
}

/**
 * Extract variables from loop data for single run
 * Returns string[] to match standard pattern used by other nodes
 */
export function extractLoopVariables(data: Partial<LoopNodeData>): string[] {
  const variableIds = new Set<string>()

  // Extract from items source
  if (data.itemsSource) {
    extractVarIdsFromString(data.itemsSource).forEach((id) => variableIds.add(id))
  }

  return Array.from(variableIds)
}

/**
 * Define output variables for the loop node
 */
export function getLoopOutputVariables(data: Partial<LoopNodeData>, nodeId: string) {
  const outputs = []

  // Loop metadata outputs
  outputs.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'totalIterations', // Changed from 'name' to 'path'
      type: 'number' as any,
      description: 'Total number of iterations executed',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'completedIterations', // Changed from 'name' to 'path'
      type: 'number' as any,
      description: 'Number of iterations completed',
    })
  )

  // Results based on accumulation setting
  if (data.accumulateResults) {
    outputs.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'results', // Changed from 'name' to 'path'
        type: 'array' as any,
        description: 'Accumulated results from all iterations',
      }),
      createUnifiedOutputVariable({
        nodeId,
        path: 'lastResult', // Changed from 'name' to 'path'
        type: 'any' as any,
        description: 'Result from the last iteration',
      })
    )
  } else {
    outputs.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'result', // Changed from 'name' to 'path'
        type: 'any' as any,
        description: 'Result from the last iteration',
      })
    )
  }

  return outputs
}

/**
 * Node definition for loop
 */
export const loopDefinition: NodeDefinition<LoopNodeData> = {
  id: NodeType.LOOP,
  category: NodeCategory.FLOW_CONTROL,
  displayName: 'Loop',
  description: 'Iterate over each item in a list',
  icon: 'repeat',
  color: '#8B5CF6', // Purple
  schema: loopConfigSchema,
  defaultData: loopDefaultData,
  canRunSingle: false, // Loops need context, can't run in isolation
  panel: LoopPanel,
  validator: validateLoop,
  extractVariables: extractLoopVariables,
  outputVariables: getLoopOutputVariables,
}
