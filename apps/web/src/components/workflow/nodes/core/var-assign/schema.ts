// apps/web/src/components/workflow/nodes/core/var-assign/schema.ts

import { type NodeManifest, varAssignManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types/unified-types'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { VarAssignNodeData, VariableAssignment } from './types'

// The data half (schemas, defaults, validator, variable extraction) lives in
// the node catalog (`@auxx/lib/workflow-engine/catalog/nodes/var-assign`).
// This file is the merge site: manifest + the web-only output resolver. The
// deprecated, consumer-less `varAssignConfigSchema` died in the move.

/**
 * Get output variables for this node
 */
export function getVarAssignOutputVariables(
  data: VarAssignNodeData,
  nodeId: string
): UnifiedVariable[] {
  // Support both old config format and new flattened format
  const variables = 'config' in data ? (data as any).config.variables : data.variables

  return variables
    .filter((v: VariableAssignment) => v.name.trim())
    .map((variable: VariableAssignment) => {
      // Generate description based on type and isArray
      const typeDescription = variable.isArray ? `Array of ${variable.type}` : variable.type

      // The engine writes an array for `isArray` assignments — advertise it as one, with
      // the declared type as the item type, so the picker offers `<node>.<name>[*]`.
      if (variable.isArray) {
        return createUnifiedOutputVariable({
          nodeId,
          path: variable.name,
          type: BaseType.ARRAY,
          description: `Custom variable of type ${typeDescription}`,
          items: {
            id: `${nodeId}.${variable.name}[*]`,
            type: variable.type,
            label: 'Item',
            category: 'node',
          },
        })
      }

      return createUnifiedOutputVariable({
        nodeId,
        path: variable.name, // Changed from 'name' to 'path'
        type: variable.type,
        description: `Custom variable of type ${typeDescription}`,
      })
    })
}

/**
 * Node definition for var-assign
 */
export const varAssignDefinition: NodeDefinition<VarAssignNodeData> = defineFromManifest(
  varAssignManifest as unknown as NodeManifest<VarAssignNodeData>,
  { outputVariables: getVarAssignOutputVariables as any }
)

// Back-compat re-exports so no consumer import churns:
export {
  extractVarAssignVariables,
  validateVarAssign,
  varAssignNodeDataSchema,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default data for new var-assign nodes (flattened)
 */
export const varAssignDefaultData = varAssignManifest.defaultData() as Partial<VarAssignNodeData>

/**
 * Factory function to create default node data (flattened)
 */
export const createVarAssignDefaultData = (): Partial<VarAssignNodeData> =>
  varAssignManifest.defaultData() as Partial<VarAssignNodeData>
