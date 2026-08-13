// packages/lib/src/workflow-engine/catalog/nodes/manual.ts

import { z } from 'zod'
import { BaseType, WorkflowTriggerType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * Manual trigger node data interface
 */
export interface ManualNodeData extends BaseNodeData {
  inputNodes?: string[] // Array of connected input node IDs
}

/**
 * Zod schema for manual trigger node data
 */
export const manualNodeDataSchema = baseNodeDataSchema.extend({
  inputNodes: z.array(z.string()).optional(),
})

/**
 * Validate manual trigger node data
 */
export function validateManualData(data: ManualNodeData): NodeValidationResult {
  const result = manualNodeDataSchema.safeParse(data)
  if (result.success) {
    return { isValid: true, errors: [] }
  }
  return {
    isValid: false,
    errors: result.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      type: 'error' as const,
    })),
  }
}

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
 * Manual trigger node manifest.
 * Note: the trigger-column derivation maps `manual` to `TriggerType.FORM`
 * (not MANUAL) — see use-workflow-save.ts; `triggerType` here is the
 * engine-side `WorkflowTriggerType`.
 */
export const manualManifest: NodeManifest<ManualNodeData> = {
  id: 'manual',
  category: NodeCategory.TRIGGER,
  displayName: 'Manual Trigger',
  description: 'Manually trigger workflow with user inputs',
  icon: 'play',
  color: '#10b981', // TRIGGER category color
  triggerType: WorkflowTriggerType.MANUAL,
  defaultData: () => ({
    title: 'Manual Trigger',
    desc: 'Manually trigger workflow with user inputs',
    inputNodes: [],
  }),
  configSchema: manualNodeDataSchema as unknown as z.ZodType<ManualNodeData>,
  validate: validateManualData,
  resolveOutputs: getManualOutputVariables,
  connection: {
    canRunSingle: false, // Triggers cannot be run individually
    acceptsInputNodes: true, // This node accepts input-node connections
  },
  agent: {
    authorable: true,
    usage:
      'The workflow starts when a user runs it by hand. `inputNodes` lists connected ' +
      'form/number/file input node ids; leave empty unless input nodes exist.',
    examples: [{ description: 'Plain manual trigger', config: { inputNodes: [] } }],
  },
}
