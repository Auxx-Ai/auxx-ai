// apps/web/src/components/workflow/nodes/core/manual/schema.ts

import { z } from 'zod'
import {
  type NodeDefinition,
  NodeCategory,
  type ValidationResult,
} from '~/components/workflow/types'
import { type ManualNodeData } from './types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { ManualPanel } from './panel'
import { NodeType } from '~/components/workflow/types/node-types'
import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import { type UnifiedVariable, BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'

/**
 * Zod schema for manual trigger node data
 */
export const manualNodeDataSchema = baseNodeDataSchema.extend({
  inputNodes: z.array(z.string()).optional(),
})

/**
 * Create default data for manual trigger node
 */
export const createManualDefaultData = (): Partial<ManualNodeData> => ({
  title: 'Manual Trigger',
  desc: 'Manually trigger workflow with user inputs',
  inputNodes: [],
})

export const manualDefaultData = createManualDefaultData()

/**
 * Validate manual trigger node data
 */
export function validateManualData(data: ManualNodeData): ValidationResult {
  try {
    manualNodeDataSchema.parse(data)
    return { isValid: true, errors: [] }
  } catch (error) {
    console.error('Manual trigger validation error:', error)
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
      errors: [{ field: 'general', message: 'Invalid configuration', type: 'error' as const }],
    }
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
      path: 'timestamp', // Changed from 'name' to 'path'
      type: BaseType.DATETIME,
      description: 'When the workflow was manually triggered',
    })
  )

  // Add user ID who triggered
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'userId', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'ID of the user who triggered the workflow',
    })
  )

  // Add input data if there are connected input nodes
  if (data.inputNodes && data.inputNodes.length > 0) {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'inputs', // Changed from 'name' to 'path'
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
export const manualDefinition: NodeDefinition<ManualNodeData> = {
  id: NodeType.MANUAL,
  category: NodeCategory.TRIGGER,
  displayName: 'Manual Trigger',
  description: 'Manually trigger workflow with user inputs',
  icon: 'play',
  color: '#10b981', // TRIGGER category color
  schema: manualNodeDataSchema,
  defaultData: manualDefaultData,
  canRunSingle: false, // Triggers cannot be run individually
  panel: ManualPanel,
  triggerType: WorkflowTriggerType.MANUAL,
  validator: validateManualData,
  outputVariables: getManualOutputVariables as any,
  acceptsInputNodes: true, // Special property to indicate this node accepts input connections
}
