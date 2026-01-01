// apps/web/src/components/workflow/nodes/core/list/extract-variables.ts

import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import type { ListNodeData } from './types'
import type { Condition } from '~/components/conditions'

/**
 * Extract variables from list node configuration
 * Matches backend implementation expectations for variable dependency tracking
 */
export function extractListVariables(data: Partial<ListNodeData>): string[] {
  const variableIds = new Set<string>()

  // 1. Always extract from input list
  if (data.inputList) {
    extractVarIdsFromString(data.inputList).forEach((id) => variableIds.add(id))
  }

  // 2. Extract based on operation type
  switch (data.operation) {
    case 'filter':
      extractFilterVariables(data, variableIds)
      break
    case 'sort':
      extractSortVariables(data, variableIds)
      break
    case 'slice':
      extractSliceVariables(data, variableIds)
      break
    case 'pluck':
      extractPluckVariables(data, variableIds)
      break
    case 'reverse':
      // No additional variables to extract
      break
  }

  return Array.from(variableIds)
}

/**
 * Extract variables from filter configuration
 */
function extractFilterVariables(
  data: Partial<ListNodeData>,
  variableIds: Set<string>
): void {
  const conditions = data.filterConfig?.conditions || []

  conditions.forEach((condition: Condition) => {
    // Extract from fieldId
    if (condition.fieldId && typeof condition.fieldId === 'string') {
      extractVarIdsFromString(condition.fieldId).forEach((id) => variableIds.add(id))
    }

    // Extract from value if it's a string and not constant
    if (condition.value && typeof condition.value === 'string' && !condition.isConstant) {
      extractVarIdsFromString(condition.value).forEach((id) => variableIds.add(id))
    }
  })
}

/**
 * Extract variables from sort configuration
 */
function extractSortVariables(
  data: Partial<ListNodeData>,
  variableIds: Set<string>
): void {
  const sortConfig = data.sortConfig
  if (!sortConfig) return

  // Extract from field reference (can be a variable)
  if (sortConfig.field && typeof sortConfig.field === 'string') {
    extractVarIdsFromString(sortConfig.field).forEach((id) => variableIds.add(id))
  }
}

/**
 * Extract variables from slice configuration
 */
function extractSliceVariables(
  data: Partial<ListNodeData>,
  variableIds: Set<string>
): void {
  const sliceConfig = data.sliceConfig
  if (!sliceConfig) return

  // Extract from count (first/last mode)
  if (
    (sliceConfig.mode === 'first' || sliceConfig.mode === 'last') &&
    !sliceConfig.isCountConstant &&
    typeof sliceConfig.count === 'string'
  ) {
    extractVarIdsFromString(sliceConfig.count).forEach((id) => variableIds.add(id))
  }

  // Extract from start (range mode)
  if (
    sliceConfig.mode === 'range' &&
    !sliceConfig.isStartConstant &&
    typeof sliceConfig.start === 'string'
  ) {
    extractVarIdsFromString(sliceConfig.start).forEach((id) => variableIds.add(id))
  }

  // Extract from end (range mode)
  if (
    sliceConfig.mode === 'range' &&
    !sliceConfig.isEndConstant &&
    typeof sliceConfig.end === 'string'
  ) {
    extractVarIdsFromString(sliceConfig.end).forEach((id) => variableIds.add(id))
  }
}

/**
 * Extract variables from pluck configuration
 */
function extractPluckVariables(
  data: Partial<ListNodeData>,
  variableIds: Set<string>
): void {
  const pluckConfig = data.pluckConfig
  if (!pluckConfig) return

  // Extract from field reference (can be a variable)
  if (pluckConfig.field && typeof pluckConfig.field === 'string') {
    extractVarIdsFromString(pluckConfig.field).forEach((id) => variableIds.add(id))
  }
}
