// apps/web/src/components/workflow/nodes/core/end/schema.ts

import { endManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { BaseType, type NodeDefinition } from '../../../types'
import { defineFromManifest } from '../../define-from-manifest'
import type { EndNodeData } from './types'

// The data half (schema, defaults, validator, variable extraction) lives in
// the node catalog (`@auxx/lib/workflow-engine/catalog/nodes/end`). This file
// is the merge site: manifest + the web-only output resolver.

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
 * Node definition for the End node
 */
export const endDefinition: NodeDefinition<EndNodeData> = defineFromManifest(
  endManifest as unknown as NodeManifest<EndNodeData>,
  { outputVariables: getEndOutputVariables as any }
)

// Back-compat re-exports so no consumer import churns:
export {
  endNodeDataSchema,
  extractEndVariables,
  validateEndConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for the End node
 */
export const endDefaultData = endManifest.defaultData() as Partial<EndNodeData>
