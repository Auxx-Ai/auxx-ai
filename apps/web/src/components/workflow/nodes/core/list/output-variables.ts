// apps/web/src/components/workflow/nodes/core/list/output-variables.ts

import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import {
  assignVariableIds,
  cloneAndRewriteVariableIds,
} from '~/components/workflow/utils/variable-cloning'
import { inferPluckOutputType } from '~/components/workflow/utils/variable-utils'
import type { ListNodeData, ListOperation } from './types'

/**
 * Validate that the input variable is an array type
 */
function validateInputArrayVariable(inputVar?: UnifiedVariable): UnifiedVariable | null {
  // Ensure it's an array type
  if (!inputVar || inputVar.type !== BaseType.ARRAY) return null
  return inputVar
}

/**
 * Compute output variables for a list node based on its operation.
 * Intelligently infers output types based on input array structure.
 *
 * @param data - List node configuration data
 * @param nodeId - Node ID for generating variable IDs
 * @param inputArrayVariable - The specific input array variable for type inference (optional, falls back to generic types)
 * @returns Array of output variables with inferred types
 *
 * NOTE: This function implements best-effort type inference. When inputArrayVariable is provided,
 * it performs intelligent type inference based on input array structure. When not provided,
 * it falls back to generic ARRAY types for compatibility.
 */
export function computeListOutputVariables(
  data: ListNodeData,
  nodeId: string,
  inputArrayVariable?: UnifiedVariable
): UnifiedVariable[] {
  const operation = data.operation as ListOperation
  const outputs: UnifiedVariable[] = []

  // Validate input array variable for type inference (if available)
  const inputArrayVar = validateInputArrayVariable(inputArrayVariable)

  // Infer result type based on operation
  let resultType: BaseType = BaseType.ARRAY
  let resultItems: UnifiedVariable | undefined
  let resultResourceId: string | undefined
  let resultProperties: Record<string, UnifiedVariable> | undefined

  switch (operation) {
    case 'filter':
    case 'sort':
    case 'unique':
    case 'reverse': {
      // These operations preserve the array structure
      // Use cloneAndRewriteVariableIds to deep clone with new IDs
      if (inputArrayVar?.items && data.inputList) {
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result[*]`

        resultItems = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        // Preserve resourceId if present
        resultResourceId = inputArrayVar.resourceId
      }
      break
    }

    case 'slice': {
      // Slice returns single item when mode=first/last and count=1, otherwise array
      const sliceConfig = data.sliceConfig
      const returnsSingleItem =
        sliceConfig &&
        (sliceConfig.mode === 'first' || sliceConfig.mode === 'last') &&
        (sliceConfig.isCountConstant ?? true) &&
        sliceConfig.count === 1

      if (returnsSingleItem && inputArrayVar?.items && data.inputList) {
        // Return the item type directly (not wrapped in array)
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result`

        // Clone the items structure and use it as the result type
        const clonedItem = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        // Set the result type to match the item type
        resultType = clonedItem.type

        // Copy nested structure based on type
        if (clonedItem.items) resultItems = clonedItem.items
        if (clonedItem.properties) resultProperties = clonedItem.properties

        resultResourceId = inputArrayVar.resourceId
      } else if (inputArrayVar?.items && data.inputList) {
        // Return array (default behavior)
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result[*]`

        resultItems = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        resultResourceId = inputArrayVar.resourceId
      }
      break
    }

    case 'pluck': {
      // Infer type from plucked field
      const pluckField = data.pluckConfig?.field
      const flatten = data.pluckConfig?.flatten || false

      if (pluckField && inputArrayVar) {
        const inferredType = inferPluckOutputType(inputArrayVar, pluckField, flatten)
        if (inferredType) {
          // Build the base result items structure
          const baseStructure: Partial<UnifiedVariable> = {
            type: inferredType.type,
            label: pluckField.split('.').pop() || 'Value',
            category: 'node' as const,
            ...(inferredType.items && { items: inferredType.items }),
            ...(inferredType.resourceId && { resourceId: inferredType.resourceId }),
            ...(inferredType.properties && { properties: inferredType.properties }),
          }

          // Use assignVariableIds to set IDs for the entire structure
          const newBaseId = `${nodeId}.result[*]`
          resultItems = assignVariableIds(baseStructure, newBaseId)
        }
      }
      break
    }

    case 'join': {
      // Join returns a string, not an array
      resultType = BaseType.STRING
      resultItems = undefined
      resultResourceId = undefined
      break
    }

    default:
      // Fallback: preserve input structure if available
      if (inputArrayVar?.items && data.inputList) {
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result[*]`

        resultItems = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        resultResourceId = inputArrayVar.resourceId
      }
  }

  // Build main result variable
  outputs.push({
    id: `${nodeId}.result`,
    type: resultType,
    label: 'Result',
    category: 'node',
    description: `Result of ${operation} operation`,
    ...(resultItems && { items: resultItems }),
    ...(resultProperties && { properties: resultProperties }),
    ...(resultResourceId && { resourceId: resultResourceId }),
  })

  // Add operation-specific metadata variables
  if (['filter', 'slice', 'unique'].includes(operation)) {
    outputs.push({
      id: `${nodeId}.count`,
      type: BaseType.NUMBER,
      label: 'Count',
      category: 'node',
      description: 'Number of items in the result',
    })
  }

  return outputs
}
