// apps/web/src/components/workflow/nodes/core/list/hooks/use-sort-config.ts

import { useCallback } from 'react'
import type { ListNodeData, SortDirection } from '../types'

/**
 * Hook to manage sort configuration for the List node.
 */
export function useSortConfig(
  nodeData: ListNodeData,
  setNodeData: (data: Partial<ListNodeData>) => void
) {
  /**
   * Get current sort field
   */
  const currentField = nodeData.sortConfig?.field

  /**
   * Get current sort direction
   */
  const currentDirection = nodeData.sortConfig?.direction || 'asc'

  /**
   * Update sort field
   */
  const handleFieldChange = useCallback(
    (field: string | undefined) => {
      if (!field || field === 'none') {
        // Remove sorting
        setNodeData({
          sortConfig: undefined,
        })
      } else {
        // Set or update sort field
        setNodeData({
          sortConfig: {
            field,
            direction: currentDirection,
            nullHandling: nodeData.sortConfig?.nullHandling,
          },
        })
      }
    },
    [nodeData.sortConfig, setNodeData, currentDirection]
  )

  /**
   * Update sort direction
   */
  const handleDirectionChange = useCallback(
    (direction: SortDirection) => {
      if (!currentField) return

      setNodeData({
        sortConfig: {
          ...nodeData.sortConfig!,
          direction,
        },
      })
    },
    [nodeData.sortConfig, setNodeData, currentField]
  )

  /**
   * Update null handling
   */
  const handleNullHandlingChange = useCallback(
    (nullHandling: 'first' | 'last' | undefined) => {
      if (!nodeData.sortConfig) return

      setNodeData({
        sortConfig: {
          ...nodeData.sortConfig,
          nullHandling,
        },
      })
    },
    [nodeData.sortConfig, setNodeData]
  )

  return {
    /** Current sort field ID (can be nested: "contact.name") */
    currentField,
    /** Current sort direction */
    currentDirection,
    /** Current null handling */
    nullHandling: nodeData.sortConfig?.nullHandling,
    /** Handler to update field */
    handleFieldChange,
    /** Handler to update direction */
    handleDirectionChange,
    /** Handler to update null handling */
    handleNullHandlingChange,
  }
}
