// apps/web/src/hooks/use-save-field-value.ts

import { useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useCustomFieldValueStore,
  buildValueKey,
  type ResourceType,
  type StoredFieldValue,
} from '~/stores/custom-field-value-store'
import { toastError } from '@auxx/ui/components/toast'
import type { ModelType } from '@auxx/types/custom-field'
import { extractValue } from '@auxx/types/field-value'

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
  const mutation = api.fieldValue.set.useMutation()
  const bulkMutation = api.fieldValue.setBulk.useMutation()

  /**
   * Extract raw value from TypedFieldValue for API calls.
   * The API accepts raw values and handles conversion internally.
   * Also handles raw values passed directly (returns them as-is).
   */
  const getRawValue = (value: StoredFieldValue | unknown): unknown => {
    if (value === null || value === undefined) return null

    // Handle TypedFieldValue array
    if (Array.isArray(value)) {
      // Check if it's an array of TypedFieldValue objects
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'type' in value[0]) {
        return value.map((v) => extractValue(v))
      }
      // Already an array of raw values
      return value
    }

    // Handle single TypedFieldValue
    if (typeof value === 'object' && value !== null && 'type' in value) {
      return extractValue(value)
    }

    // Already a raw value (string, number, boolean, etc.)
    return value
  }

  /**
   * Save a field value with optimistic update.
   * Returns immediately after updating store - mutation runs in background.
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldId - The custom field ID
   * @param value - The value to save (raw value or TypedFieldValue)
   */
  const saveValue = useCallback(
    (resourceId: string, fieldId: string, value: StoredFieldValue | unknown): void => {
      const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)

      // 1. Optimistic update to store with typed value
      setValueOptimistic(key, value)

      // 2. Fire mutation in background with raw value (API handles conversion)
      const rawValue = getRawValue(value)
      mutation.mutate(
        {
          entityId: resourceId,
          fieldId,
          value: rawValue,
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
   * @param value - The value to save (raw value or TypedFieldValue)
   */
  const saveFieldValue = useCallback(
    (fieldId: string, value: StoredFieldValue | unknown): void => {
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
   * Use when you need to know the result (e.g., getting the valueIds).
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldId - The custom field ID
   * @param value - The value to save (raw value or TypedFieldValue)
   */
  const saveValueAsync = useCallback(
    async (resourceId: string, fieldId: string, value: StoredFieldValue | unknown): Promise<{ ids: string[] } | undefined> => {
      const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)

      setValueOptimistic(key, value)

      try {
        const rawValue = getRawValue(value)
        const result = await mutation.mutateAsync({
          entityId: resourceId,
          fieldId,
          value: rawValue,
          modelType,
        })

        confirmOptimistic(key)
        onSuccess?.()
        return { ids: (result as { ids: string[] })?.ids ?? [] }
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
   * @param value - The value to save (raw value or TypedFieldValue)
   */
  const saveFieldValueAsync = useCallback(
    async (fieldId: string, value: StoredFieldValue | unknown): Promise<{ ids: string[] } | undefined> => {
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
   * @param value - The value to set for all resources (raw value or TypedFieldValue)
   */
  const saveBulkValues = useCallback(
    (resourceIds: string[], fieldId: string, value: StoredFieldValue | unknown): void => {
      const keys = resourceIds.map((id) => buildValueKey(resourceType, id, fieldId, entityDefId))

      // Apply optimistic updates to all
      for (const key of keys) {
        setValueOptimistic(key, value)
      }

      // Fire single bulk mutation with raw value
      const rawValue = getRawValue(value)
      bulkMutation.mutate(
        {
          entityIds: resourceIds,
          values: [{ fieldId, value: rawValue }],
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
