// apps/web/src/components/workflow/nodes/core/list/hooks/use-pluck-config.ts

import { useCallback } from 'react'
import type { ListNodeData } from '../types'

/**
 * Hook to manage pluck configuration for the List node.
 *
 * Pluck extracts a specific field from each item in an array.
 * Supports deep nested paths (e.g., "contact.createdBy.firstName").
 */
export function usePluckConfig(
  nodeData: ListNodeData,
  setNodeData: (data: Partial<ListNodeData>) => void
) {
  /**
   * Get current pluck field
   */
  const currentField = nodeData.pluckConfig?.field

  /**
   * Get current flatten setting
   */
  const currentFlatten = nodeData.pluckConfig?.flatten ?? false

  /**
   * Update pluck field
   */
  const handleFieldChange = useCallback(
    (field: string | undefined) => {
      if (!field || field === 'none') {
        // Remove pluck config
        setNodeData({
          pluckConfig: undefined,
        })
      } else {
        // Set or update pluck field
        setNodeData({
          pluckConfig: {
            field,
            flatten: currentFlatten,
          },
        })
      }
    },
    [setNodeData, currentFlatten]
  )

  /**
   * Update flatten setting
   */
  const handleFlattenChange = useCallback(
    (flatten: boolean) => {
      if (!currentField) return

      setNodeData({
        pluckConfig: {
          field: currentField,
          flatten,
        },
      })
    },
    [setNodeData, currentField]
  )

  return {
    /** Current pluck field path (can be deeply nested: "contact.createdBy.firstName") */
    currentField,
    /** Current flatten setting (only applicable for ARRAY fields) */
    currentFlatten,
    /** Handler to update field */
    handleFieldChange,
    /** Handler to update flatten */
    handleFlattenChange,
  }
}
