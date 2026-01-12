// apps/web/src/components/resources/hooks/use-save-field-value.ts

import { useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useCustomFieldValueStore,
  buildFieldValueKeyFromParts,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/custom-field-value-store'
import { toResourceId, toResourceIds, type ResourceId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { formatToTypedInput, isArrayReturnFieldType } from '@auxx/lib/field-values/client'
import {
  useRelationshipSync,
  extractRelatedIds,
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
  /** Entity definition ID (e.g., 'contact', 'ticket', or a custom entity UUID) */
  entityDefinitionId: string
  /** Default resourceId (entity instance ID) - can be overridden per-call */
  resourceId?: string
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
  oldIds: string[]
  newIds: string[]
}

/** Prepare optimistic update and capture rollback info */
function prepareOptimisticUpdate(
  entityDefinitionId: string,
  resourceId: string,
  fieldId: string,
  value: unknown,
  fieldType: FieldType,
  getFieldMetadata?: (fieldId: string) => FieldMetadata | undefined
): OptimisticUpdatePrep {
  const key = buildFieldValueKeyFromParts(entityDefinitionId, resourceId, fieldId)
  const store = useCustomFieldValueStore.getState()

  // Capture old value for relationship sync rollback
  const oldValue = store.values[key]

  // Increment version BEFORE optimistic update (for race condition handling)
  const mutationVersion = store.incrementMutationVersion(key)

  // Optimistic update to store (convert to TypedFieldValue format)
  const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
  store.setValueOptimistic(key, typedValue)

  // Relationship sync prep
  let inverseInfo: InverseSyncInfo | null = null
  let oldIds: string[] = []
  let newIds: string[] = []

  if (fieldType === 'RELATIONSHIP' && entityDefinitionId) {
    const metadata = getFieldMetadata?.(fieldId)
    const rel = metadata?.relationship

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
    }
  }

  return { key, mutationVersion, typedValue, inverseInfo, oldIds, newIds }
}

/** Handle mutation success - apply server result to store */
function handleMutationSuccess(
  key: FieldValueKey,
  mutationVersion: number,
  result: { values?: Array<{ id?: string }> } | undefined,
  fieldType: FieldType
): boolean {
  const store = useCustomFieldValueStore.getState()
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
  prep: { inverseInfo: InverseSyncInfo | null; oldIds: string[]; newIds: string[] },
  resourceId: string,
  syncInverseCache: (input: {
    sourceEntityId: string
    oldRelatedIds: string[]
    newRelatedIds: string[]
    inverseInfo: InverseSyncInfo
  }) => void,
  error: Error | unknown
): void {
  const store = useCustomFieldValueStore.getState()
  const currentVersion = store.getMutationVersion(key)

  if (mutationVersion < currentVersion) return // Superseded

  store.rollbackOptimistic(key)

  // Rollback inverse cache (swap old/new to reverse)
  if (prep.inverseInfo) {
    syncInverseCache({
      sourceEntityId: resourceId,
      oldRelatedIds: prep.newIds,
      newRelatedIds: prep.oldIds,
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
export function useSaveFieldValue(options: UseSaveFieldValueOptions) {
  const { entityDefinitionId, resourceId: defaultResourceId, onSuccess, getFieldMetadata } = options

  // Relationship sync hook
  const { syncInverseCache } = useRelationshipSync()

  // Mutations
  const mutation = api.fieldValue.set.useMutation()
  const bulkMutation = api.fieldValue.setBulk.useMutation()

  /**
   * Save a field value with optimistic update.
   * Returns immediately after updating store - mutation runs in background.
   * @param fieldId - The custom field ID
   * @param value - The value to save (raw value or TypedFieldValue)
   * @param fieldType - The field type for proper value extraction
   */
  const saveFieldValue = useCallback(
    (fieldId: string, value: StoredFieldValue | unknown, fieldType: FieldType): void => {
      if (!defaultResourceId) {
        console.error('saveFieldValue called without resourceId')
        return
      }

      const prep = prepareOptimisticUpdate(
        entityDefinitionId,
        defaultResourceId,
        fieldId,
        value,
        fieldType,
        getFieldMetadata
      )

      // Sync relationship cache
      if (prep.inverseInfo) {
        syncInverseCache({
          sourceEntityId: defaultResourceId,
          oldRelatedIds: prep.oldIds,
          newRelatedIds: prep.newIds,
          inverseInfo: prep.inverseInfo,
        })
      }

      // Fire mutation with ResourceId format
      const resourceId = toResourceId(entityDefinitionId, defaultResourceId)
      mutation.mutate(
        { resourceId, fieldId, value },
        {
          onSuccess: (result) => {
            if (handleMutationSuccess(prep.key, prep.mutationVersion, result, fieldType)) {
              onSuccess?.()
            }
          },
          onError: (error) => {
            handleMutationError(prep.key, prep.mutationVersion, prep, defaultResourceId, syncInverseCache, error)
          },
        }
      )
    },
    [entityDefinitionId, defaultResourceId, mutation, onSuccess, getFieldMetadata, syncInverseCache]
  )

  /**
   * Async version that waits for mutation to complete.
   * Use when you need confirmation of save completion or the value ID (for FILE fields).
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
        console.error('saveFieldValueAsync called without resourceId')
        return undefined
      }

      const prep = prepareOptimisticUpdate(
        entityDefinitionId,
        defaultResourceId,
        fieldId,
        value,
        fieldType,
        getFieldMetadata
      )

      // Sync relationship cache
      if (prep.inverseInfo) {
        syncInverseCache({
          sourceEntityId: defaultResourceId,
          oldRelatedIds: prep.oldIds,
          newRelatedIds: prep.newIds,
          inverseInfo: prep.inverseInfo,
        })
      }

      try {
        const resourceId = toResourceId(entityDefinitionId, defaultResourceId)
        const result = await mutation.mutateAsync({ resourceId, fieldId, value })

        // Check if stale (a newer mutation was fired)
        const store = useCustomFieldValueStore.getState()
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
        const store = useCustomFieldValueStore.getState()
        if (prep.mutationVersion < store.getMutationVersion(prep.key)) {
          return undefined
        }

        handleMutationError(prep.key, prep.mutationVersion, prep, defaultResourceId, syncInverseCache, error)
        return undefined
      }
    },
    [entityDefinitionId, defaultResourceId, mutation, onSuccess, getFieldMetadata, syncInverseCache]
  )

  /**
   * Save multiple field values to a single resource (async version).
   * Applies optimistic updates, waits for mutation to complete.
   * @param instanceId - The entity instance ID
   * @param fieldValues - Array of { fieldId, value, fieldType } to save
   */
  const saveMultipleAsync = useCallback(
    async (
      instanceId: string,
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): Promise<boolean> => {
      const store = useCustomFieldValueStore.getState()

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: string; version: number }> = []
      for (const { fieldId, value, fieldType } of fieldValues) {
        const key = buildFieldValueKeyFromParts(entityDefinitionId, instanceId, fieldId)
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
        store.setValueOptimistic(key, typedValue)
      }

      // Build API payload
      const apiValues = fieldValues.map(({ fieldId, value }) => ({ fieldId, value }))

      try {
        // Send ResourceId format
        const resourceIds = [toResourceId(entityDefinitionId, instanceId)]
        await bulkMutation.mutateAsync({ resourceIds, values: apiValues })

        const currentStore = useCustomFieldValueStore.getState()
        for (const { key, version } of keyVersions) {
          if (version >= currentStore.getMutationVersion(key)) {
            currentStore.confirmOptimistic(key)
          }
        }
        onSuccess?.()
        return true
      } catch (error: unknown) {
        const currentStore = useCustomFieldValueStore.getState()
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
    [entityDefinitionId, bulkMutation, onSuccess]
  )

  /**
   * Save the same field value for multiple resources in a single API call.
   * Applies optimistic updates to all resources, then fires one bulk mutation.
   * @param instanceIds - Array of entity instance IDs to update
   * @param fieldId - The field ID to update
   * @param value - The value to set for all resources
   * @param fieldType - The field type for proper value extraction
   */
  const saveBulkValues = useCallback(
    (
      instanceIds: string[],
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType
    ): void => {
      const store = useCustomFieldValueStore.getState()

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: FieldValueKey; version: number }> = []
      const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
      for (const id of instanceIds) {
        const key = buildFieldValueKeyFromParts(entityDefinitionId, id, fieldId)
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        store.setValueOptimistic(key, typedValue)
      }

      // Send ResourceId format
      const resourceIds = toResourceIds(entityDefinitionId, instanceIds)
      bulkMutation.mutate(
        { resourceIds, values: [{ fieldId, value }] },
        {
          onSuccess: () => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                currentStore.confirmOptimistic(key)
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useCustomFieldValueStore.getState()
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
    [entityDefinitionId, bulkMutation, onSuccess]
  )

  /**
   * Save multiple field values to multiple resources in one API call.
   * Applies optimistic updates to store immediately. Fire-and-forget.
   * @param instanceIds - Array of entity instance IDs to update
   * @param fieldValues - Array of { fieldId, value, fieldType } to set for all resources
   */
  const saveBulkMultipleFields = useCallback(
    (
      instanceIds: string[],
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
    ): void => {
      const store = useCustomFieldValueStore.getState()

      // Build all keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: string; version: number }> = []
      for (const instanceId of instanceIds) {
        for (const { fieldId, value, fieldType } of fieldValues) {
          const key = buildFieldValueKeyFromParts(entityDefinitionId, instanceId, fieldId)
          const version = store.incrementMutationVersion(key)
          keyVersions.push({ key, version })
          const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
          store.setValueOptimistic(key, typedValue)
        }
      }

      // Build API payload and send ResourceId format
      const apiValues = fieldValues.map(({ fieldId, value }) => ({ fieldId, value }))
      const resourceIds = toResourceIds(entityDefinitionId, instanceIds)

      bulkMutation.mutate(
        { resourceIds, values: apiValues },
        {
          onSuccess: () => {
            const currentStore = useCustomFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                currentStore.confirmOptimistic(key)
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useCustomFieldValueStore.getState()
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
    [entityDefinitionId, bulkMutation, onSuccess]
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
