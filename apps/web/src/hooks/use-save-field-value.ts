// apps/web/src/hooks/use-save-field-value.ts

import { useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useCustomFieldValueStore,
  buildValueKey,
  type ResourceType,
} from '~/stores/custom-field-value-store'
import { toastError } from '@auxx/ui/components/toast'
import type { ModelType } from '@auxx/types/custom-field'

interface UseSaveFieldValueOptions {
  resourceType: ResourceType
  /** Default resourceId - can be overridden per-call */
  resourceId?: string
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
  const { resourceType, resourceId: defaultResourceId, entityDefId, modelType, onSuccess } = options

  // Get store actions
  const setValueOptimistic = useCustomFieldValueStore((s) => s.setValueOptimistic)
  const confirmOptimistic = useCustomFieldValueStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useCustomFieldValueStore((s) => s.rollbackOptimistic)

  // Mutations
  const mutation = api.customField.setValue.useMutation()
  const bulkMutation = api.customField.bulkSetValues.useMutation()

  /**
   * Save a field value with optimistic update.
   * Returns immediately after updating store - mutation runs in background.
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldId - The custom field ID
   * @param value - The value to save
   */
  const saveValue = useCallback(
    (resourceId: string, fieldId: string, value: unknown): void => {
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
   * Save using the default resourceId from options.
   * Convenience method for single-resource contexts (e.g., contact drawer).
   * @param fieldId - The custom field ID
   * @param value - The value to save
   */
  const saveFieldValue = useCallback(
    (fieldId: string, value: unknown): void => {
      if (!defaultResourceId) {
        console.error('saveFieldValue called without resourceId - use saveValue instead')
        return
      }
      saveValue(defaultResourceId, fieldId, value)
    },
    [defaultResourceId, saveValue]
  )

  /**
   * Async version that waits for mutation to complete.
   * Use when you need to know the result (e.g., getting the valueId).
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldId - The custom field ID
   * @param value - The value to save
   */
  const saveValueAsync = useCallback(
    async (resourceId: string, fieldId: string, value: unknown): Promise<{ id?: string } | undefined> => {
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
   * Async version using the default resourceId from options.
   * Convenience method for single-resource contexts.
   * @param fieldId - The custom field ID
   * @param value - The value to save
   */
  const saveFieldValueAsync = useCallback(
    async (fieldId: string, value: unknown): Promise<{ id?: string } | undefined> => {
      if (!defaultResourceId) {
        console.error('saveFieldValueAsync called without resourceId - use saveValueAsync instead')
        return undefined
      }
      return saveValueAsync(defaultResourceId, fieldId, value)
    },
    [defaultResourceId, saveValueAsync]
  )

  /**
   * Save the same field value for multiple resources in a single API call.
   * Applies optimistic updates to all resources, then fires one bulk mutation.
   * @param resourceIds - Array of resource IDs to update
   * @param fieldId - The field ID to update
   * @param value - The value to set for all resources
   */
  const saveBulkValues = useCallback(
    (resourceIds: string[], fieldId: string, value: unknown): void => {
      const keys = resourceIds.map((id) => buildValueKey(resourceType, id, fieldId, entityDefId))

      // Apply optimistic updates to all
      for (const key of keys) {
        setValueOptimistic(key, value)
      }

      // Fire single bulk mutation
      bulkMutation.mutate(
        {
          entityIds: resourceIds,
          values: [{ fieldId, value: value === null ? null : { data: value } }],
          modelType,
        },
        {
          onSuccess: () => {
            for (const key of keys) {
              confirmOptimistic(key)
            }
            onSuccess?.()
          },
          onError: (error) => {
            for (const key of keys) {
              rollbackOptimistic(key)
            }
            toastError({
              title: 'Error saving fields',
              description: error.message || 'Could not save field values',
            })
          },
        }
      )
    },
    [
      resourceType,
      entityDefId,
      modelType,
      bulkMutation,
      setValueOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
    ]
  )

  return {
    /** Save with explicit resourceId (for multi-resource contexts like kanban) */
    saveValue,
    /** Save with explicit resourceId, async (for multi-resource contexts) */
    saveValueAsync,
    /** Save using default resourceId (for single-resource contexts like drawers) */
    saveFieldValue,
    /** Save using default resourceId, async (for single-resource contexts) */
    saveFieldValueAsync,
    /** Save same value to multiple resources in one API call (for bulk operations) */
    saveBulkValues,
    isPending: mutation.isPending,
  }
}
