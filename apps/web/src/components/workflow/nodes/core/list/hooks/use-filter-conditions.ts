// apps/web/src/components/workflow/nodes/core/list/hooks/use-filter-conditions.ts

import { useCallback } from 'react'
import type { Condition } from '~/components/conditions'
import type { FilterConfig, ListNodeData } from '../types'

/**
 * Derive the node-level AND/OR key from the condition rows.
 *
 * The shared condition list owns the AND/OR selector and writes the choice onto every
 * condition after the first. The engine reads a single `filterConfig.logic`, so mirror
 * the toggle here instead of adding a second control that could disagree with it.
 */
function deriveFilterLogic(conditions: Condition[]): NonNullable<FilterConfig['logic']> {
  for (let index = 1; index < conditions.length; index++) {
    const logicalOperator = conditions[index]?.logicalOperator
    if (logicalOperator) return logicalOperator
  }

  return 'AND'
}

/**
 * Hook to manage filter conditions for the List node.
 *
 * This hook provides a simple interface for reading and updating
 * the filter conditions without group management complexity.
 *
 * @param nodeData - Current node data
 * @param setNodeData - Function to update node data
 * @returns Conditions array, the resolved AND/OR logic and a handler to update conditions
 */
export function useFilterConditions(
  nodeData: ListNodeData,
  setNodeData: (data: ListNodeData) => void
) {
  /**
   * Handler to update the filter conditions
   */
  const handleConditionsChange = useCallback(
    (conditions: Condition[]) => {
      setNodeData({
        ...nodeData,
        filterConfig: {
          ...nodeData.filterConfig,
          conditions,
          logic: deriveFilterLogic(conditions),
        },
      })
    },
    [nodeData, setNodeData]
  )

  return {
    /** Current filter conditions */
    conditions: nodeData.filterConfig?.conditions || [],
    /** How those conditions combine — persisted on `filterConfig.logic` */
    logic: nodeData.filterConfig?.logic ?? 'AND',
    /** Handler to update conditions */
    handleConditionsChange,
  }
}
