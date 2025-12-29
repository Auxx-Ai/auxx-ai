// apps/web/src/hooks/use-save-field-value.ts

import { useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useCustomFieldValueStore,
  buildValueKey,
  type ResourceType,
} from '~/stores/custom-field-value-store'
import { toastError } from '@auxx/ui/components/toast'
import type { ModelType } from '@auxx/lib/custom-fields/types'

interface UseSaveFieldValueOptions {
  resourceType: ResourceType
  resourceId: string
  entityDefId?: string
  modelType: ModelType
  /** Optional callback after successful save */
  onSuccess?: () => void
}

/**
 * Hook for saving field values with optimistic updates to the shared store.
 * Updates store immediately, then syncs to DB in background.
 * Automatically rolls back on error.
 */
export function useSaveFieldValue(options: UseSaveFieldValueOptions) {
  const { resourceType, resourceId, entityDefId, modelType, onSuccess } = options

  // Get store actions
  const setValueOptimistic = useCustomFieldValueStore((s) => s.setValueOptimistic)
  const confirmOptimistic = useCustomFieldValueStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useCustomFieldValueStore((s) => s.rollbackOptimistic)

  // Mutation
  const mutation = api.customField.setValue.useMutation()

  /**
   * Save a field value with optimistic update.
   * Returns immediately after updating store - mutation runs in background.
   */
  const saveValue = useCallback(
    (fieldId: string, value: unknown): void => {
      const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)

      // 1. Optimistic update to store (table sees it immediately)
      setValueOptimistic(key, value)

      // 2. Fire mutation in background
      mutation.mutate(
        {
          entityId: resourceId,
          fieldId,
          value: value === null ? null : { data: value },
          modelType,
        },
        {
          onSuccess: () => {
            confirmOptimistic(key)
            onSuccess?.()
          },
          onError: (error) => {
            rollbackOptimistic(key)
            toastError({
              title: 'Error saving field',
              description: error.message || 'Could not save this field value',
            })
          },
        }
      )
    },
    [
      resourceType,
      resourceId,
      entityDefId,
      modelType,
      mutation,
      setValueOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
    ]
  )

  /**
   * Async version that waits for mutation to complete.
   * Use when you need to know the result (e.g., getting the valueId).
   */
  const saveValueAsync = useCallback(
    async (fieldId: string, value: unknown): Promise<{ id?: string } | undefined> => {
      const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)

      setValueOptimistic(key, value)

      try {
        const result = await mutation.mutateAsync({
          entityId: resourceId,
          fieldId,
          value: value === null ? null : { data: value },
          modelType,
        })

        confirmOptimistic(key)
        onSuccess?.()
        return { id: (result as { id?: string })?.id }
      } catch (error: unknown) {
        rollbackOptimistic(key)
        const errorMessage = error instanceof Error ? error.message : 'Could not save this field value'
        toastError({
          title: 'Error saving field',
          description: errorMessage,
        })
        return undefined
      }
    },
    [
      resourceType,
      resourceId,
      entityDefId,
      modelType,
      mutation,
      setValueOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
    ]
  )

  return {
    saveValue,
    saveValueAsync,
    isPending: mutation.isPending,
  }
}
