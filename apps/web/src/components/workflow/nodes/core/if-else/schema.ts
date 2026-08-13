// apps/web/src/components/workflow/nodes/core/if-else/schema.ts

import { ifElseManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import { BaseType, type NodeDefinition } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '../../../utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { IfElseNodeData } from './types'

// The data half (condition/case types, schema, defaults, validator, variable
// extraction, branch rules) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/if-else`). This file is the merge
// site: manifest + the web-only output resolver. The deprecated,
// consumer-less `ifElseSchema` died in the move.

/**
 * Define output variables for if-else node
 */
function getIfElseOutputVariables(_data: IfElseNodeData, nodeId: string): any[] {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'matched_condition',
      type: BaseType.STRING,
      description: 'Which condition was matched (case ID)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'condition_index',
      type: BaseType.NUMBER,
      description: 'Index of the matched condition (0-based)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'branch_taken',
      type: BaseType.STRING,
      description: 'Which branch was taken (true/false)',
      enum: ['true', 'false'],
    }),
  ]
}

/**
 * Node definition for if-else
 */
export const ifElseDefinition: NodeDefinition<IfElseNodeData> = defineFromManifest(
  ifElseManifest as unknown as NodeManifest<IfElseNodeData>,
  { outputVariables: getIfElseOutputVariables as any }
)

// Back-compat re-exports so no consumer import churns:
export {
  ifElseNodeDataSchema,
  validateIfElseConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default data for new if-else nodes (flattened)
 */
export const ifElseDefaultData = ifElseManifest.defaultData() as Partial<IfElseNodeData>
