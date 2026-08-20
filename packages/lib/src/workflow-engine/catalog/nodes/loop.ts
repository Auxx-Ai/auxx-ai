// packages/lib/src/workflow-engine/catalog/nodes/loop.ts

import { z } from 'zod'
import type { BaseNodeData } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'
import { extractVarIdsFromString } from '../variable-inference'

export const LOOP_CONSTANTS = {
  DEFAULT_MAX_ITERATIONS: 100,
  ABSOLUTE_MAX_ITERATIONS: 1000,
  DEFAULT_ITERATOR_NAME: 'item',
} as const

/**
 * The loop node's structural handles. A loop is three edges, not one:
 * `loop-start` (source) → first body node, last body node → `loop-back`
 * (TARGET handle on the loop node), and `source` → whatever follows the loop.
 * Body nodes additionally carry top-level `parentId` for containment — which
 * is correctness-critical: the initializer regenerates `isLoopBackEdge` from
 * it (and from the `loop-back` handle).
 */
export const LOOP_HANDLES = {
  LOOP_START: 'loop-start', // Source handle that connects to first node in loop body
  LOOP_BACK: 'loop-back', // Target handle where nodes inside loop connect to restart iteration
} as const

/**
 * Node data for loop nodes (flattened structure)
 */
export interface LoopNodeData extends BaseNodeData {
  itemsSource: string // variable path to array like "{{customers}}"
  iteratorName?: string // @deprecated - always 'item' now, kept for backwards compatibility
  maxIterations: number // safety limit
  accumulateResults: boolean
}

/**
 * Zod schema for loop configuration
 */
export const loopConfigSchema = z.object({
  title: z.string().default('Loop'),
  desc: z.string().optional(),
  // Empty is a legitimate PERSISTED state — the canvas default has no items
  // source until the user picks one. Completeness lives in `validateLoop`.
  itemsSource: z.string().default(''),
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
 * Validation function for loop data
 */
export function validateLoop(data: Partial<LoopNodeData>): NodeValidationResult {
  const parsed = loopConfigSchema.safeParse(data)
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

  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Completeness: an items source is required to actually run
  if (!data.itemsSource || !data.itemsSource.trim()) {
    errors.push({ field: 'itemsSource', message: 'Items source is required', type: 'error' })
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

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
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
function getLoopOutputVariables(data: Partial<LoopNodeData>, nodeId: string) {
  const outputs = []

  // Loop metadata outputs
  outputs.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'totalIterations',
      type: 'number' as any,
      description: 'Total number of iterations executed',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'completedIterations',
      type: 'number' as any,
      description: 'Number of iterations completed',
    })
  )

  // Results based on accumulation setting
  if (data.accumulateResults) {
    outputs.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'results',
        type: 'array' as any,
        description: 'Accumulated results from all iterations',
      }),
      createUnifiedOutputVariable({
        nodeId,
        path: 'lastResult',
        type: 'any' as any,
        description: 'Result from the last iteration',
      })
    )
  } else {
    outputs.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'result',
        type: 'any' as any,
        description: 'Result from the last iteration',
      })
    )
  }

  return outputs
}

/**
 * Loop node manifest
 */
export const loopManifest: NodeManifest<LoopNodeData> = {
  id: 'loop',
  category: NodeCategory.FLOW_CONTROL,
  displayName: 'Loop',
  description: 'Iterate over each item in a list',
  icon: 'repeat',
  /** Extra `list_node_types` search words — never displayed (see NodeManifest.synonyms). */
  synonyms: ['for each', 'foreach', 'iterate', 'iteration', 'repeat', 'each', 'map over'],
  color: '#8B5CF6', // Purple
  defaultData: () => ({
    title: 'Loop',
    itemsSource: '',
    // iteratorName is deprecated - always 'item' now
    maxIterations: LOOP_CONSTANTS.DEFAULT_MAX_ITERATIONS,
    accumulateResults: true,
  }),
  configSchema: loopConfigSchema as unknown as z.ZodType<LoopNodeData>,
  validate: validateLoop,
  extractVariables: extractLoopVariables,
  resolveOutputs: getLoopOutputVariables,
  connection: {
    canRunSingle: false, // Loops need context, can't run in isolation
    /**
     * Source handles only — `loop-back` is a TARGET handle on the loop node
     * and so not a branch here. Exactly one `loop-start` edge is required
     * (the engine's validateLoopStructure throws otherwise).
     */
    branches: (): NodeBranch[] => [
      { id: 'source', name: '', kind: 'default' },
      { id: LOOP_HANDLES.LOOP_START, name: 'Loop Start', kind: 'default' },
    ],
  },
  agent: {
    authorable: true,
    usage:
      "A loop is three edges: loop-start → first body node, last body node → the loop's " +
      'loop-back TARGET handle, and source → whatever follows. Body nodes set top-level ' +
      'parentId to the loop for containment. Reference the current item with node-scoped ' +
      'refs only: {{<Loop Title>.item}} / .index / .count — never bare {{item}}.',
    examples: [
      {
        description: 'Loop over found tickets',
        config: { itemsSource: '{{find-1.tickets}}', maxIterations: 100, accumulateResults: true },
      },
    ],
  },
}
