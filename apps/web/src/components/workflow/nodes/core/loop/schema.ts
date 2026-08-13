// apps/web/src/components/workflow/nodes/core/loop/schema.ts

import { loopManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { LoopNodeData } from './types'

// The data half (constants, schema, defaults, validator, variable extraction,
// handle declarations) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/loop`). This file is the merge
// site: manifest + the web-only output resolver.

/**
 * Define output variables for the loop node
 */
export function getLoopOutputVariables(data: Partial<LoopNodeData>, nodeId: string) {
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
 * Node definition for loop
 */
export const loopDefinition: NodeDefinition<LoopNodeData> = defineFromManifest(
  loopManifest as unknown as NodeManifest<LoopNodeData>,
  { outputVariables: getLoopOutputVariables }
)

// Back-compat re-exports so no consumer import churns:
export {
  extractLoopVariables,
  loopConfigSchema,
  validateLoop,
} from '@auxx/lib/workflow-engine/client'

/**
 * Factory function to create default data (flattened structure)
 */
export const createLoopDefaultData = (): Partial<LoopNodeData> =>
  loopManifest.defaultData() as Partial<LoopNodeData>

/**
 * Default data for new loop nodes
 */
export const loopDefaultData: Partial<LoopNodeData> = createLoopDefaultData()
