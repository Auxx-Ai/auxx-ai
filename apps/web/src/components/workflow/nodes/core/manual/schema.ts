// apps/web/src/components/workflow/nodes/core/manual/schema.ts

import { manualManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { ManualNodeData } from './types'

// The data half (schema, defaults, validator) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/manual`). This file is the merge
// site: manifest + the web-only output resolver.

/**
 * Define output variables for manual trigger node
 */
function getManualOutputVariables(data: ManualNodeData, nodeId: string): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // Add trigger timestamp
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'timestamp',
      type: BaseType.DATETIME,
      description: 'When the workflow was manually triggered',
    })
  )

  // Add user ID who triggered
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'userId',
      type: BaseType.STRING,
      description: 'ID of the user who triggered the workflow',
    })
  )

  // Add input data if there are connected input nodes
  if (data.inputNodes && data.inputNodes.length > 0) {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'inputs',
        type: BaseType.OBJECT,
        description: 'Data collected from connected input nodes',
      })
    )
  }

  return variables
}

/**
 * Manual trigger node definition
 */
export const manualDefinition: NodeDefinition<ManualNodeData> = defineFromManifest(
  manualManifest as unknown as NodeManifest<ManualNodeData>,
  { outputVariables: getManualOutputVariables as any }
)

// Back-compat re-exports so no consumer import churns:
export { manualNodeDataSchema, validateManualData } from '@auxx/lib/workflow-engine/client'

/**
 * Create default data for manual trigger node
 */
export const createManualDefaultData = (): Partial<ManualNodeData> =>
  manualManifest.defaultData() as Partial<ManualNodeData>

export const manualDefaultData = createManualDefaultData()
