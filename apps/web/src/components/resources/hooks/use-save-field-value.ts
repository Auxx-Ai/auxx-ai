// apps/web/src/components/resources/hooks/use-save-field-value.ts

import { useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/field-value-store'
import { parseResourceId, type ResourceId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { formatToTypedInput, isArrayReturnFieldType } from '@auxx/lib/field-values/client'
import {
  useRelationshipSync,
  extractRelatedResourceIds,
  type InverseSyncInfo,
} from './use-relationship-sync'
import { getInverseCardinality, type RelationshipType } from '@auxx/utils'

import { type FieldType } from '@auxx/database/types'
import type { RelationshipConfig } from '@auxx/types/custom-field'

/** Field metadata for relationship sync */
interface FieldMetadata {
  type: string
  relationship?: Pick<
    RelationshipConfig,
    'isInverse' | 'inverseFieldId' | 'relationshipType' | 'relatedEntityDefinitionId'
  >
}

interface UseSaveFieldValueOptions {
  /** Optional callback after successful save */
  onSuccess?: () => void
  /** Optional field metadata provider for relationship sync */
  getFieldMetadata?: (fieldId: string) => FieldMetadata | undefined
}

/** Result of optimistic update preparation */
interface OptimisticUpdatePrep {
  key: FieldValueKey
  mutationVersion: number
  typedValue: unknown
  inverseInfo: InverseSyncInfo | null
  oldRelatedResourceIds: ResourceId[]
  newRelatedResourceIds: ResourceId[]
}

/** Prepare optimistic update and capture rollback info */
function prepareOptimisticUpdate(
  resourceId: ResourceId,
  fieldId: string,
  value: unknown,
  fieldType: FieldType,
  getFieldMetadata?: (fieldId: string) => FieldMetadata | undefined
): OptimisticUpdatePrep {
  const key = buildFieldValueKey(resourceId, fieldId)
  const store = useFieldValueStore.getState()

  // Capture old value for relationship sync rollback
  const oldValue = store.values[key]

  // Increment version BEFORE optimistic update (for race condition handling)
  const mutationVersion = store.incrementMutationVersion(key)

  // Optimistic update to store (convert to TypedFieldValue format)
  const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
  store.setValueOptimistic(key, typedValue)

  // Relationship sync prep
  let inverseInfo: InverseSyncInfo | null = null
  let oldRelatedResourceIds: ResourceId[] = []
  let newRelatedResourceIds: ResourceId[] = []

  if (fieldType === 'RELATIONSHIP') {
    const { entityDefinitionId } = parseResourceId(resourceId)
    const metadata = getFieldMetadata?.(fieldId)
    const rel = metadata?.relationship

    if (rel?.inverseFieldId && rel.relationshipType && rel.relatedEntityDefinitionId) {
      oldRelatedResourceIds = extractRelatedResourceIds(oldValue)
      newRelatedResourceIds = extractRelatedResourceIds(typedValue)

      inverseInfo = {
        inverseFieldId: rel.inverseFieldId,
        inverseRelationshipType: getInverseCardinality(rel.relationshipType),
        sourceEntityDefinitionId: entityDefinitionId,
        targetEntityDefinitionId: rel.relatedEntityDefinitionId,
        sourceFieldId: fieldId,
      }
    }
  }

  return {
    key,
    mutationVersion,
    typedValue,
    inverseInfo,
    oldRelatedResourceIds,
    newRelatedResourceIds,
  }
}

/** Handle mutation success - apply server result to store */
function handleMutationSuccess(
  key: FieldValueKey,
  mutationVersion: number,
  result: { values?: Array<{ id?: string }> } | undefined,
  fieldType: FieldType
): boolean {
  const store = useFieldValueStore.getState()
  const currentVersion = store.getMutationVersion(key)

  if (mutationVersion < currentVersion) return false // Stale

  if (result?.values && result.values.length > 0) {
    const returnsArray = fieldType && isArrayReturnFieldType(fieldType)
    store.setValue(key, returnsArray ? result.values : result.values[0])
  } else if (fieldType && isArrayReturnFieldType(fieldType)) {
    store.setValue(key, [])
  } else {
    store.confirmOptimistic(key)
  }

  return true
}

/** Handle mutation error with rollback */
function handleMutationError(
  key: FieldValueKey,
  mutationVersion: number,
  prep: {
    inverseInfo: InverseSyncInfo | null
    oldRelatedResourceIds: ResourceId[]
    newRelatedResourceIds: ResourceId[]
  },
  sourceResourceId: ResourceId,
  syncInverseCache: (input: {
    sourceResourceId: ResourceId
    oldRelatedResourceIds: ResourceId[]
    newRelatedResourceIds: ResourceId[]
    inverseInfo: InverseSyncInfo
  }) => void,
  error: Error | unknown
): void {
  const store = useFieldValueStore.getState()
  const currentVersion = store.getMutationVersion(key)

  if (mutationVersion < currentVersion) return // Superseded

  store.rollbackOptimistic(key)

  // Rollback inverse cache (swap old/new to reverse)
  if (prep.inverseInfo) {
    syncInverseCache({
      sourceResourceId,
      oldRelatedResourceIds: prep.newRelatedResourceIds, // Swap!
      newRelatedResourceIds: prep.oldRelatedResourceIds, // Swap!
      inverseInfo: prep.inverseInfo,
    })
  }

  const errorMessage = error instanceof Error ? error.message : 'Could not save this field value'
  toastError({
    title: 'Error saving field',
    description: errorMessage,
  })
}

/**
 * Hook for saving field values with optimistic updates to the shared store.
 * Updates store immediately, then syncs to DB in background.
 * Automatically rolls back on error.
 */
export function useSaveFieldValue(options: UseSaveFieldValueOptions = {}) {
  const { onSuccess, getFieldMetadata } = options

  // Relationship sync hook
  const { syncInverseCache } = useRelationshipSync()

  // Mutations
  const mutation = api.fieldValue.set.useMutation()
  const bulkMutation = api.fieldValue.setBulk.useMutation()

  /**
   * Save a field value with optimistic update.
   * @param resourceId - Full ResourceId (entityDefinitionId:entityInstanceId)
   * @param fieldId - The custom field ID
   * @param value - The value to save
   * @param fieldType - The field type for proper value extraction
   */
  const saveFieldValue = useCallback(
    (
      resourceId: ResourceId,
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): void => {
      const prep = prepareOptimisticUpdate(resourceId, fieldId, value, fieldType, getFieldMetadata)

      // Sync relationship cache
      if (prep.inverseInfo) {
        syncInverseCache({
          sourceResourceId: resourceId,
          oldRelatedResourceIds: prep.oldRelatedResourceIds,
          newRelatedResourceIds: prep.newRelatedResourceIds,
          inverseInfo: prep.inverseInfo,
        })
      }

      // Fire mutation
      mutation.mutate(
        { resourceId, fieldId, value },
        {
          onSuccess: (result) => {
            if (handleMutationSuccess(prep.key, prep.mutationVersion, result, fieldType)) {
              onSuccess?.()
            }
          },
          onError: (error) => {
            handleMutationError(
              prep.key,
              prep.mutationVersion,
              prep,
              resourceId,
              syncInverseCache,
              error
            )
          },
        }
      )
    },
    [mutation, onSuccess, getFieldMetadata, syncInverseCache]
  )

  /**
   * Async version that waits for mutation to complete.
   * @param resourceId - Full ResourceId (entityDefinitionId:entityInstanceId)
   * @param fieldId - The custom field ID
   * @param value - The value to save
   * @param fieldType - The field type for proper value extraction
   * @returns Object with success flag and optional id (first value's ID if available)
   */
  const saveFieldValueAsync = useCallback(
    async (
      resourceId: ResourceId,
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): Promise<{ success: boolean; id?: string } | undefined> => {
      const prep = prepareOptimisticUpdate(resourceId, fieldId, value, fieldType, getFieldMetadata)

      // Sync relationship cache
      if (prep.inverseInfo) {
        syncInverseCache({
          sourceResourceId: resourceId,
          oldRelatedResourceIds: prep.oldRelatedResourceIds,
          newRelatedResourceIds: prep.newRelatedResourceIds,
          inverseInfo: prep.inverseInfo,
        })
      }

      try {
        const result = await mutation.mutateAsync({ resourceId, fieldId, value })

        // Check if stale (a newer mutation was fired)
        const store = useFieldValueStore.getState()
        if (prep.mutationVersion < store.getMutationVersion(prep.key)) {
          return { success: true }
        }

        // Apply server result
        const firstValueId = result?.values?.[0]?.id
        handleMutationSuccess(prep.key, prep.mutationVersion, result, fieldType)
        onSuccess?.()
        return { success: true, id: firstValueId }
      } catch (error: unknown) {
        // Check if superseded
        const store = useFieldValueStore.getState()
        if (prep.mutationVersion < store.getMutationVersion(prep.key)) {
          return undefined
        }

        handleMutationError(
          prep.key,
          prep.mutationVersion,
          prep,
          resourceId,
          syncInverseCache,
          error
        )
        return undefined
      }
    },
    [mutation, onSuccess, getFieldMetadata, syncInverseCache]
  )

  /**
   * Save multiple field values to a single resource (async version).
   * @param resourceId - Full ResourceId
   * @param fieldValues - Array of { fieldId, value, fieldType }
   */
  const saveMultipleAsync = useCallback(
    async (
      resourceId: ResourceId,
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): Promise<boolean> => {
      const store = useFieldValueStore.getState()

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: string; version: number }> = []
      for (const { fieldId, value, fieldType } of fieldValues) {
        const key = buildFieldValueKey(resourceId, fieldId)
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
        store.setValueOptimistic(key, typedValue)
      }

      // Build API payload
      const apiValues = fieldValues.map(({ fieldId, value }) => ({ fieldId, value }))

      try {
        await bulkMutation.mutateAsync({ resourceIds: [resourceId], values: apiValues })

        const currentStore = useFieldValueStore.getState()
        for (const { key, version } of keyVersions) {
          if (version >= currentStore.getMutationVersion(key)) {
            currentStore.confirmOptimistic(key)
          }
        }
        onSuccess?.()
        return true
      } catch (error: unknown) {
        const currentStore = useFieldValueStore.getState()
        for (const { key, version } of keyVersions) {
          if (version >= currentStore.getMutationVersion(key)) {
            currentStore.rollbackOptimistic(key)
          }
        }
        const errorMessage = error instanceof Error ? error.message : 'Could not save field values'
        toastError({ title: 'Error saving fields', description: errorMessage })
        return false
      }
    },
    [bulkMutation, onSuccess]
  )

  /**
   * Save the same field value for multiple resources in a single API call.
   * @param resourceIds - Array of ResourceIds to update
   * @param fieldId - The field ID to update
   * @param value - The value to set for all resources
   * @param fieldType - The field type
   */
  const saveBulkValues = useCallback(
    (
      resourceIds: ResourceId[],
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): void => {
      const store = useFieldValueStore.getState()

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: FieldValueKey; version: number }> = []
      const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value

      for (const resourceId of resourceIds) {
        const key = buildFieldValueKey(resourceId, fieldId)
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        store.setValueOptimistic(key, typedValue)
      }

      // Fire mutation
      bulkMutation.mutate(
        { resourceIds, values: [{ fieldId, value }] },
        {
          onSuccess: () => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                currentStore.confirmOptimistic(key)
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                currentStore.rollbackOptimistic(key)
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
    [bulkMutation, onSuccess]
  )

  /**
   * Save multiple field values to multiple resources in one API call.
   * @param resourceIds - Array of ResourceIds to update
   * @param fieldValues - Array of { fieldId, value, fieldType }
   */
  const saveBulkMultipleFields = useCallback(
    (
      resourceIds: ResourceId[],
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): void => {
      const store = useFieldValueStore.getState()

      // Build all keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: string; version: number }> = []

      for (const resourceId of resourceIds) {
        for (const { fieldId, value, fieldType } of fieldValues) {
          const key = buildFieldValueKey(resourceId, fieldId)
          const version = store.incrementMutationVersion(key)
          keyVersions.push({ key, version })
          const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
          store.setValueOptimistic(key, typedValue)
        }
      }

      // Build API payload
      const apiValues = fieldValues.map(({ fieldId, value }) => ({ fieldId, value }))

      bulkMutation.mutate(
        { resourceIds, values: apiValues },
        {
          onSuccess: () => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                currentStore.confirmOptimistic(key)
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                currentStore.rollbackOptimistic(key)
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
    [bulkMutation, onSuccess]
  )

  return {
    /** Save single field (for single-resource contexts like drawers) */
    saveFieldValue,
    /** Save single field, async - use for FILE fields that need value ID */
    saveFieldValueAsync,
    /** Save multiple fields to single resource, async */
    saveMultipleAsync,
    /** Save same value to multiple resources in one API call (for bulk operations) */
    saveBulkValues,
    /** Save multiple fields to multiple resources in one API call (for bulk dialogs) */
    saveBulkMultipleFields,
    isPending: mutation.isPending || bulkMutation.isPending,
  }
}
