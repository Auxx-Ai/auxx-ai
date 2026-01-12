// apps/web/src/hooks/use-save-field-value.ts

import { useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useCustomFieldValueStore,
  buildFieldValueKeyFromParts,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/custom-field-value-store'
import { getModelType } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import {
  formatToTypedInput,
  formatToRawValue,
  isArrayReturnFieldType,
} from '@auxx/lib/field-values/client'
import {
  useRelationshipSync,
  extractRelatedIds,
  type InverseSyncInfo,
} from './use-relationship-sync'
import { getInverseCardinality, type RelationshipType } from '@auxx/utils'

import { type FieldType } from '@auxx/database/types'

/** Field metadata for relationship sync */
interface FieldMetadata {
  type: string
  relationship?: {
    isInverse?: boolean
    inverseFieldId?: string
    relationshipType?: RelationshipType
    relatedEntityDefinitionId?: string
    relatedModelType?: string
  }
}

interface UseSaveFieldValueOptions {
  /** Entity definition ID (e.g., 'contact', 'ticket', or a custom entity UUID) */
  entityDefinitionId: string
  /** Default resourceId (entity instance ID) - can be overridden per-call */
  resourceId?: string
  /** Optional callback after successful save */
  onSuccess?: () => void
  /** Optional field metadata provider for relationship sync */
  getFieldMetadata?: (fieldId: string) => FieldMetadata | undefined
}

/**
 * Hook for saving field values with optimistic updates to the shared store.
 * Updates store immediately, then syncs to DB in background.
 * Automatically rolls back on error.
 */
export function useSaveFieldValue(options: UseSaveFieldValueOptions) {
  const { entityDefinitionId, resourceId: defaultResourceId, onSuccess, getFieldMetadata } = options

  // Derive modelType from entityDefinitionId
  const modelType = getModelType(entityDefinitionId)

  // Get store actions
  const setValue = useCustomFieldValueStore((s) => s.setValue)
  const setValueOptimistic = useCustomFieldValueStore((s) => s.setValueOptimistic)
  const confirmOptimistic = useCustomFieldValueStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useCustomFieldValueStore((s) => s.rollbackOptimistic)

  // Relationship sync hook
  const { syncInverseCache } = useRelationshipSync()

  // Mutations
  const mutation = api.fieldValue.set.useMutation()
  const bulkMutation = api.fieldValue.setBulk.useMutation()

  /**
   * Extract raw value from TypedFieldValue for API calls using centralized formatter.
   * The API accepts raw values and handles conversion internally.
   * @param value - The value (TypedFieldValue or raw)
   * @param fieldType - The field type for proper extraction
   */
  const getRawValue = (value: StoredFieldValue | unknown, fieldType: FieldType): unknown => {
    if (value === null || value === undefined) return null

    // If we have fieldType, use the centralized formatter
    if (fieldType) {
      return formatToRawValue(value, fieldType)
    }

    // Fallback for legacy code paths without fieldType
    // This handles the case where value is already raw
    return value
  }

  /**
   * Save a field value with optimistic update.
   * Returns immediately after updating store - mutation runs in background.
   * Uses version tracking to handle race conditions with rapid updates.
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldId - The custom field ID
   * @param value - The value to save (raw value or TypedFieldValue)
   * @param fieldType - The field type for proper value extraction
   */
  const saveValue = useCallback(
    (
      resourceId: string,
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): void => {
      const key = buildFieldValueKeyFromParts(entityDefinitionId, resourceId, fieldId)
      const store = useCustomFieldValueStore.getState()

      // Capture old value for relationship sync rollback
      const oldValue = store.values[key]

      // 1. Increment version BEFORE optimistic update (for race condition handling)
      const mutationVersion = store.incrementMutationVersion(key)

      // 2. Optimistic update to store (convert to TypedFieldValue format)
      const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
      setValueOptimistic(key, typedValue)

      // 3. Sync inverse relationships for RELATIONSHIP fields
      let inverseInfo: InverseSyncInfo | null = null
      let oldIds: string[] = []
      let newIds: string[] = []

      if (fieldType === 'RELATIONSHIP' && entityDefinitionId) {
        const metadata = getFieldMetadata?.(fieldId)
        const rel = metadata?.relationship

        // Sync if we have inverse field config (works from either side - no isInverse check needed)
        if (rel?.inverseFieldId && rel.relationshipType && rel.relatedEntityDefinitionId) {
          oldIds = extractRelatedIds(oldValue)
          newIds = extractRelatedIds(typedValue)

          inverseInfo = {
            inverseFieldId: rel.inverseFieldId,
            inverseRelationshipType: getInverseCardinality(rel.relationshipType),
            sourceEntityDefinitionId: entityDefinitionId,
            targetEntityDefId: rel.relatedEntityDefinitionId,
            sourceFieldId: fieldId,
          }

          syncInverseCache({
            sourceEntityId: resourceId,
            oldRelatedIds: oldIds,
            newRelatedIds: newIds,
            inverseInfo,
          })
        }
      }

      // 4. Fire mutation in background with raw value (API handles conversion)
      const rawValue = getRawValue(value, fieldType)
      mutation.mutate(
        {
          resourceId,
          fieldId,
          value: rawValue,
          modelType,
        },
        {
          onSuccess: (result) => {
            // Check if this mutation is still the latest (race condition handling)
            const currentVersion = useCustomFieldValueStore.getState().getMutationVersion(key)
            if (mutationVersion < currentVersion) {
              // A newer mutation was fired - skip this stale response
              // The optimistic state from the newer mutation is already correct
              return
            }

            // This is the latest - apply the server result
            if (result?.values && result.values.length > 0) {
              // Array-return fields (SINGLE_SELECT, MULTI_SELECT, TAGS, RELATIONSHIP, FILE) store as array
              // Other single-value fields store just the first value
              const returnsArray = fieldType && isArrayReturnFieldType(fieldType)
              const valueToStore = returnsArray ? result.values : result.values[0]
              setValue(key, valueToStore)
            } else if (fieldType && isArrayReturnFieldType(fieldType)) {
              // Array-return field with no values should store empty array
              setValue(key, [])
            } else {
              confirmOptimistic(key)
            }
            onSuccess?.()
          },
          onError: (error) => {
            // Check if this mutation is still the latest
            const currentVersion = useCustomFieldValueStore.getState().getMutationVersion(key)
            if (mutationVersion < currentVersion) {
              // A newer mutation superseded this one - don't rollback
              return
            }

            // Rollback primary field
            rollbackOptimistic(key)

            // Rollback inverse cache (swap old/new to reverse the sync)
            if (inverseInfo) {
              syncInverseCache({
                sourceEntityId: resourceId,
                oldRelatedIds: newIds,
                newRelatedIds: oldIds,
                inverseInfo,
              })
            }

            toastError({
              title: 'Error saving field',
              description: error.message || 'Could not save this field value',
            })
          },
        }
      )
    },
    [
      entityDefinitionId,
      modelType,
      mutation,
      setValueOptimistic,
      setValue,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
      getFieldMetadata,
      syncInverseCache,
    ]
  )

  /**
   * Save using the default resourceId from options.
   * Convenience method for single-resource contexts (e.g., contact drawer).
   * @param fieldId - The custom field ID
   * @param value - The value to save (raw value or TypedFieldValue)
   * @param fieldType - The field type for proper value extraction
   */
  const saveFieldValue = useCallback(
    (fieldId: string, value: StoredFieldValue | unknown, fieldType: FieldType): void => {
      if (!defaultResourceId) {
        console.error('saveFieldValue called without resourceId - use saveValue instead')
        return
      }
      saveValue(defaultResourceId, fieldId, value, fieldType)
    },
    [defaultResourceId, saveValue]
  )

  /**
   * Async version that waits for mutation to complete.
   * Use when you need confirmation of save completion or the value ID (for FILE fields).
   * Uses version tracking to handle race conditions with rapid updates.
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldId - The custom field ID
   * @param value - The value to save (raw value or TypedFieldValue)
   * @param fieldType - The field type for proper value extraction
   * @returns Object with success flag and optional id (first value's ID if available)
   */
  const saveValueAsync = useCallback(
    async (
      resourceId: string,
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): Promise<{ success: boolean; id?: string } | undefined> => {
      const key = buildFieldValueKeyFromParts(entityDefinitionId, resourceId, fieldId)
      const store = useCustomFieldValueStore.getState()

      // Capture old value for relationship sync rollback
      const oldValue = store.values[key]

      // 1. Increment version BEFORE optimistic update (for race condition handling)
      const mutationVersion = store.incrementMutationVersion(key)

      // 2. Optimistic update with TypedFieldValue format
      const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
      setValueOptimistic(key, typedValue)

      // 3. Sync inverse relationships for RELATIONSHIP fields
      let inverseInfo: InverseSyncInfo | null = null
      let oldIds: string[] = []
      let newIds: string[] = []

      if (fieldType === 'RELATIONSHIP' && entityDefinitionId) {
        const metadata = getFieldMetadata?.(fieldId)
        const rel = metadata?.relationship

        // Sync if we have inverse field config (works from either side - no isInverse check needed)
        if (rel?.inverseFieldId && rel.relationshipType && rel.relatedEntityDefinitionId) {
          oldIds = extractRelatedIds(oldValue)
          newIds = extractRelatedIds(typedValue)

          inverseInfo = {
            inverseFieldId: rel.inverseFieldId,
            inverseRelationshipType: getInverseCardinality(rel.relationshipType),
            sourceEntityDefinitionId: entityDefinitionId,
            targetEntityDefId: rel.relatedEntityDefinitionId,
            sourceFieldId: fieldId,
          }

          syncInverseCache({
            sourceEntityId: resourceId,
            oldRelatedIds: oldIds,
            newRelatedIds: newIds,
            inverseInfo,
          })
        }
      }

      try {
        const rawValue = getRawValue(value, fieldType)
        const result = await mutation.mutateAsync({
          resourceId,
          fieldId,
          value: rawValue,
          modelType,
        })

        // Check if this mutation is still the latest (race condition handling)
        const currentVersion = useCustomFieldValueStore.getState().getMutationVersion(key)
        if (mutationVersion < currentVersion) {
          // A newer mutation was fired - skip applying this stale response
          // Return success since the optimistic state is already correct
          return { success: true }
        }

        // This is the latest - apply the server result
        // Extract the first value's ID (useful for FILE fields that need to attach files)
        const firstValueId = result?.values?.[0]?.id
        if (result?.values && result.values.length > 0) {
          // Array-return fields (SINGLE_SELECT, MULTI_SELECT, TAGS, RELATIONSHIP, FILE) store as array
          const returnsArray = fieldType && isArrayReturnFieldType(fieldType)
          const valueToStore = returnsArray ? result.values : result.values[0]
          setValue(key, valueToStore)
        } else if (fieldType && isArrayReturnFieldType(fieldType)) {
          // Array-return field with no values should store empty array
          setValue(key, [])
        } else {
          confirmOptimistic(key)
        }
        onSuccess?.()
        return { success: true, id: firstValueId }
      } catch (error: unknown) {
        // Check if this mutation is still the latest
        const currentVersion = useCustomFieldValueStore.getState().getMutationVersion(key)
        if (mutationVersion < currentVersion) {
          // A newer mutation superseded this one - don't rollback or show error
          return undefined
        }

        // Rollback primary field
        rollbackOptimistic(key)

        // Rollback inverse cache (swap old/new to reverse the sync)
        if (inverseInfo) {
          syncInverseCache({
            sourceEntityId: resourceId,
            oldRelatedIds: newIds,
            newRelatedIds: oldIds,
            inverseInfo,
          })
        }

        const errorMessage =
          error instanceof Error ? error.message : 'Could not save this field value'
        toastError({
          title: 'Error saving field',
          description: errorMessage,
        })
        return undefined
      }
    },
    [
      entityDefinitionId,
      modelType,
      mutation,
      setValueOptimistic,
      setValue,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
      getFieldMetadata,
      syncInverseCache,
    ]
  )

  /**
   * Async version using the default resourceId from options.
   * Convenience method for single-resource contexts.
   * @param fieldId - The custom field ID
   * @param value - The value to save (raw value or TypedFieldValue)
   * @param fieldType - The field type for proper value extraction
   * @returns Object with success flag and optional id (first value's ID if available)
   */
  const saveFieldValueAsync = useCallback(
    async (
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): Promise<{ success: boolean; id?: string } | undefined> => {
      if (!defaultResourceId) {
        console.error('saveFieldValueAsync called without resourceId - use saveValueAsync instead')
        return undefined
      }
      return saveValueAsync(defaultResourceId, fieldId, value, fieldType)
    },
    [defaultResourceId, saveValueAsync]
  )

  /**
   * Save multiple field values to a single resource.
   * Applies optimistic updates to store immediately. Fire-and-forget.
   * Uses version tracking to handle race conditions with rapid updates.
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldValues - Array of { fieldId, value, fieldType } to save
   */
  const saveMultiple = useCallback(
    (
      resourceId: string,
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): void => {
      const store = useCustomFieldValueStore.getState()

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: string; version: number }> = []
      for (const { fieldId, value, fieldType } of fieldValues) {
        const key = buildFieldValueKeyFromParts(entityDefinitionId, resourceId, fieldId)
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
        setValueOptimistic(key, typedValue)
      }

      // Build API payload with raw values
      const apiValues = fieldValues.map(({ fieldId, value, fieldType }) => ({
        fieldId,
        value: getRawValue(value, fieldType),
      }))

      // Fire mutation (fire-and-forget)
      bulkMutation.mutate(
        {
          resourceIds: [resourceId],
          values: apiValues,
          modelType,
        },
        {
          onSuccess: () => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              // Only confirm if still the latest version
              if (version >= currentStore.getMutationVersion(key)) {
                confirmOptimistic(key)
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              // Only rollback if still the latest version
              if (version >= currentStore.getMutationVersion(key)) {
                rollbackOptimistic(key)
              }
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
      entityDefinitionId,
      modelType,
      bulkMutation,
      setValueOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
    ]
  )

  /**
   * Save multiple field values to a single resource (async version).
   * Applies optimistic updates, waits for mutation to complete.
   * Uses version tracking to handle race conditions with rapid updates.
   * @param resourceId - The resource ID (entity/contact/ticket ID)
   * @param fieldValues - Array of { fieldId, value, fieldType } to save
   */
  const saveMultipleAsync = useCallback(
    async (
      resourceId: string,
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): Promise<boolean> => {
      const store = useCustomFieldValueStore.getState()

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: string; version: number }> = []
      for (const { fieldId, value, fieldType } of fieldValues) {
        const key = buildFieldValueKeyFromParts(entityDefinitionId, resourceId, fieldId)
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
        setValueOptimistic(key, typedValue)
      }

      // Build API payload with raw values
      const apiValues = fieldValues.map(({ fieldId, value, fieldType }) => ({
        fieldId,
        value: getRawValue(value, fieldType),
      }))

      try {
        await bulkMutation.mutateAsync({
          resourceIds: [resourceId],
          values: apiValues,
          modelType,
        })

        const currentStore = useCustomFieldValueStore.getState()
        for (const { key, version } of keyVersions) {
          // Only confirm if still the latest version
          if (version >= currentStore.getMutationVersion(key)) {
            confirmOptimistic(key)
          }
        }
        onSuccess?.()
        return true
      } catch (error: unknown) {
        const currentStore = useCustomFieldValueStore.getState()
        for (const { key, version } of keyVersions) {
          // Only rollback if still the latest version
          if (version >= currentStore.getMutationVersion(key)) {
            rollbackOptimistic(key)
          }
        }
        const errorMessage = error instanceof Error ? error.message : 'Could not save field values'
        toastError({
          title: 'Error saving fields',
          description: errorMessage,
        })
        return false
      }
    },
    [
      entityDefinitionId,
      modelType,
      bulkMutation,
      setValueOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
    ]
  )

  /**
   * Save multiple field values using the default resourceId.
   * Convenience method for single-resource contexts.
   * @param fieldValues - Array of { fieldId, value, fieldType } to save
   */
  const saveMultipleFields = useCallback(
    (fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>): void => {
      if (!defaultResourceId) {
        console.error('saveMultipleFields called without resourceId - use saveMultiple instead')
        return
      }
      saveMultiple(defaultResourceId, fieldValues)
    },
    [defaultResourceId, saveMultiple]
  )

  /**
   * Save multiple field values using the default resourceId (async version).
   * Convenience method for single-resource contexts.
   * @param fieldValues - Array of { fieldId, value, fieldType } to save
   */
  const saveMultipleFieldsAsync = useCallback(
    async (
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): Promise<boolean> => {
      if (!defaultResourceId) {
        console.error(
          'saveMultipleFieldsAsync called without resourceId - use saveMultipleAsync instead'
        )
        return false
      }
      return saveMultipleAsync(defaultResourceId, fieldValues)
    },
    [defaultResourceId, saveMultipleAsync]
  )

  /**
   * Save the same field value for multiple resources in a single API call.
   * Applies optimistic updates to all resources, then fires one bulk mutation.
   * Uses version tracking to handle race conditions with rapid updates.
   * @param resourceIds - Array of resource IDs to update
   * @param fieldId - The field ID to update
   * @param value - The value to set for all resources (raw value or TypedFieldValue)
   * @param fieldType - The field type for proper value extraction
   */
  const saveBulkValues = useCallback(
    (
      resourceIds: string[],
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): void => {
      const store = useCustomFieldValueStore.getState()

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: FieldValueKey; version: number }> = []
      const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
      for (const id of resourceIds) {
        const key = buildFieldValueKeyFromParts(entityDefinitionId, id, fieldId)
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        setValueOptimistic(key, typedValue)
      }

      // Fire single bulk mutation with raw value
      const rawValue = getRawValue(value, fieldType)
      bulkMutation.mutate(
        {
          resourceIds,
          values: [{ fieldId, value: rawValue }],
          modelType,
        },
        {
          onSuccess: () => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              // Only confirm if still the latest version
              if (version >= currentStore.getMutationVersion(key)) {
                confirmOptimistic(key)
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              // Only rollback if still the latest version
              if (version >= currentStore.getMutationVersion(key)) {
                rollbackOptimistic(key)
              }
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
      entityDefinitionId,
      modelType,
      bulkMutation,
      setValueOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      onSuccess,
    ]
  )

  /**
   * Save multiple field values to multiple resources in one API call.
   * Applies optimistic updates to store immediately. Fire-and-forget.
   * Uses version tracking to handle race conditions with rapid updates.
   * @param resourceIds - Array of resource IDs to update
   * @param fieldValues - Array of { fieldId, value, fieldType } to set for all resources
   */
  const saveBulkMultipleFields = useCallback(
    (
      resourceIds: string[],
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): void => {
      const store = useCustomFieldValueStore.getState()

      // Build all keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: string; version: number }> = []
      for (const resourceId of resourceIds) {
        for (const { fieldId, value, fieldType } of fieldValues) {
          const key = buildFieldValueKeyFromParts(entityDefinitionId, resourceId, fieldId)
          const version = store.incrementMutationVersion(key)
          keyVersions.push({ key, version })
          const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
          setValueOptimistic(key, typedValue)
        }
      }

      // Build API payload with raw values
      const apiValues = fieldValues.map(({ fieldId, value, fieldType }) => ({
        fieldId,
        value: getRawValue(value, fieldType),
      }))

      // Fire single bulk mutation (fire-and-forget)
      bulkMutation.mutate(
        {
          resourceIds,
          values: apiValues,
          modelType,
        },
        {
          onSuccess: () => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              // Only confirm if still the latest version
              if (version >= currentStore.getMutationVersion(key)) {
                confirmOptimistic(key)
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              // Only rollback if still the latest version
              if (version >= currentStore.getMutationVersion(key)) {
                rollbackOptimistic(key)
              }
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
      entityDefinitionId,
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
    /** Save multiple fields to single resource with explicit resourceId */
    saveMultiple,
    /** Save multiple fields to single resource with explicit resourceId, async */
    saveMultipleAsync,
    /** Save multiple fields using default resourceId */
    saveMultipleFields,
    /** Save multiple fields using default resourceId, async */
    saveMultipleFieldsAsync,
    /** Save same value to multiple resources in one API call (for bulk operations) */
    saveBulkValues,
    /** Save multiple fields to multiple resources in one API call (for bulk dialogs) */
    saveBulkMultipleFields,
    isPending: mutation.isPending || bulkMutation.isPending,
  }
}
