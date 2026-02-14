// apps/web/src/components/workflow/nodes/core/list/hooks/use-filter-conditions.ts

import { useCallback } from 'react'
import type { Condition } from '~/components/conditions'
import type { ListNodeData } from '../types'

/**
 * Hook to manage filter conditions for the List node.
 *
 * This hook provides a simple interface for reading and updating
 * the filter conditions without group management complexity.
 *
 * @param nodeData - Current node data
 * @param setNodeData - Function to update node data
 * @returns Conditions array and handler to update conditions
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
        },
      })
    },
    [nodeData, setNodeData]
  )

  return {
    /** Current filter conditions */
    conditions: nodeData.filterConfig?.conditions || [],
    /** Handler to update conditions */
    handleConditionsChange,
  }
}
