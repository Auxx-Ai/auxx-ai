// apps/web/src/components/workflow/nodes/core/list/output-variables.ts

import { getFieldId, isResourceFieldId } from '@auxx/types/field'
import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import type { OutputVariableContext } from '~/components/workflow/types/output-variables'
import {
  assignVariableIds,
  cloneAndRewriteVariableIds,
} from '~/components/workflow/utils/variable-cloning'
import { inferPluckOutputType } from '~/components/workflow/utils/variable-utils'
import type { ListNodeData, ListOperation } from './types'

/**
 * Convert a FieldReference (string or string[]) to a dot-separated field key path.
 * - "ticket:email" → "email"
 * - ["ticket:contact", "contact:firstName"] → "contact.firstName"
 * - "email" → "email" (plain key passthrough)
 */
function fieldRefToKeyPath(field: string | string[]): string {
  if (Array.isArray(field)) {
    return field.map((rfId) => getFieldId(rfId)).join('.')
  }
  if (isResourceFieldId(field)) {
    return getFieldId(field)
  }
  return field
}

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
 * @param context - Output variable context with resolveVariable for upstream variable lookup
 * @returns Array of output variables with inferred types
 *
 * NOTE: This function implements best-effort type inference. When the input array variable
 * can be resolved via context.resolveVariable, it performs intelligent type inference based
 * on input array structure. Otherwise, it falls back to generic ARRAY types.
 */
export function computeListOutputVariables(
  data: ListNodeData,
  nodeId: string,
  context: OutputVariableContext
): UnifiedVariable[] {
  // Resolve the input array variable from upstream
  const inputVariableId = data.inputList?.replace(/[{}]/g, '')
  const inputArrayVariable = inputVariableId ? context.resolveVariable(inputVariableId) : undefined
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
      const pluckFieldRef = data.pluckConfig?.field
      const flatten = data.pluckConfig?.flatten || false

      if (pluckFieldRef && inputArrayVar) {
        const pluckKeyPath = fieldRefToKeyPath(pluckFieldRef)
        const inferredType = inferPluckOutputType(inputArrayVar, pluckKeyPath, flatten)
        if (inferredType) {
          // Build the base result items structure
          const baseStructure: Partial<UnifiedVariable> = {
            type: inferredType.type,
            label: pluckKeyPath.split('.').pop() || 'Value',
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
