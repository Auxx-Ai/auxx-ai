// apps/web/src/components/workflow/hooks/use-title-validation.ts

import { useState, useCallback } from 'react'
import { isTitleUnique } from '../utils/unique-title-generator'
import { useStoreApi } from '@xyflow/react'

/** Error types for title validation */
export type TitleErrorType = 'empty' | 'duplicate' | 'contains-dot' | null

/**
 * Hook for validating node titles for uniqueness and valid characters
 * @param nodeId The ID of the node being edited
 * @returns Object containing titleError state and validateTitle function
 */
export function useTitleValidation(nodeId: string) {
  const [titleError, setTitleError] = useState<TitleErrorType>(null)
  const store = useStoreApi()

  const validateTitle = useCallback(
    (title: string): boolean => {
      if (!title.trim()) {
        setTitleError('empty')
        return false
      }

      // Dots are reserved for node path splitting
      if (title.includes('.')) {
        setTitleError('contains-dot')
        return false
      }

      const { nodes } = store.getState()
      const isUnique = isTitleUnique(title, nodes, nodeId)

      if (!isUnique) {
        setTitleError('duplicate')
        return false
      }

      setTitleError(null)
      return true
    },
    [store, nodeId]
  )

  return { titleError, validateTitle }
}
