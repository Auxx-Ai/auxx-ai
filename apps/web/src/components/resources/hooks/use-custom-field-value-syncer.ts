// apps/web/src/components/resources/hooks/use-custom-field-value-syncer.ts

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useFieldValueStore,
  buildFieldValueKey,
  parseFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/field-value-store'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { VisibilityState } from '@tanstack/react-table'
import { generateId } from '@auxx/utils/generateId'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'

interface UseCustomFieldValueSyncerOptions {
  /** RecordIds for the entities being displayed */
  recordIds: RecordId[]

  /** Column visibility state from DynamicTable */
  columnVisibility: VisibilityState

  /** ResourceFieldIds for columns (e.g., ['contact:email', 'contact:abc']) */
  resourceFieldIds: string[]

  /** Whether syncing is enabled */
  enabled?: boolean

  /** Debounce delay in ms (default: 150) */
  debounceMs?: number
}

interface SyncerResult {
  /** Whether a fetch is currently in progress */
  isFetching: boolean

  /** Get a value from the store (returns TypedFieldValue | TypedFieldValue[] | null) */
  getValue: (recordId: RecordId, resourceFieldId: ResourceFieldId) => StoredFieldValue | undefined

  /** Check if a value is currently loading */
  isValueLoading: (recordId: RecordId, resourceFieldId: ResourceFieldId) => boolean
}

/**
 * Hook that syncs custom field values based on visible columns and rows.
 * Batches requests and deduplicates to minimize API calls.
 *
 * @example
 * ```tsx
 * // Pass resourceFieldIds in ResourceFieldId format
 * useCustomFieldValueSyncer({
 *   recordIds,
 *   columnVisibility,
 *   resourceFieldIds: customFields.map(f => f.resourceFieldId),
 *   enabled: customFields.length > 0,
 * })
 * ```
 */
export function useCustomFieldValueSyncer(options: UseCustomFieldValueSyncerOptions): SyncerResult {
  const { recordIds, columnVisibility, resourceFieldIds, enabled = true, debounceMs = 150 } = options

  // Get store actions (stable references)
  const setValues = useFieldValueStore((s) => s.setValues)
  const startLoading = useFieldValueStore((s) => s.startLoading)
  const finishLoading = useFieldValueStore((s) => s.finishLoading)
  // NOTE: Don't subscribe to values/loadingBatches - use getState() imperatively
  // Subscribing would cause re-renders on every value change

  const pendingFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Extract field IDs from ResourceFieldIds and filter by visibility
  const visibleFieldIds = useMemo(() => {
    return resourceFieldIds
      .filter((resourceFieldId) => columnVisibility[resourceFieldId] !== false)
      .map((resourceFieldId) => {
        const { fieldId } = parseResourceFieldId(resourceFieldId)
        return fieldId
      })
  }, [resourceFieldIds, columnVisibility])

  // Helper to check if a key is loading (uses getState, not subscription)
  const isKeyLoading = useCallback((key: FieldValueKey) => {
    const { loadingBatches } = useFieldValueStore.getState()
    for (const batch of Object.values(loadingBatches)) {
      if (batch.keys.has(key)) return true
    }
    return false
  }, [])

  // Compute needed keys imperatively inside effect (not as reactive dependency)
  const computeNeededKeys = useCallback(() => {
    if (!enabled || visibleFieldIds.length === 0 || recordIds.length === 0) {
      return []
    }

    const { values } = useFieldValueStore.getState()
    const keys: FieldValueKey[] = []

    for (const recordId of recordIds) {
      for (const fieldId of visibleFieldIds) {
        const key = buildFieldValueKey(recordId, fieldId)
        if (!(key in values) && !isKeyLoading(key)) {
          keys.push(key)
        }
      }
    }
    return keys
  }, [enabled, visibleFieldIds, recordIds, isKeyLoading])

  // Mutation for batch fetching
  const batchFetch = api.fieldValue.batchGet.useMutation()

  // Debounced fetch trigger - runs when inputs change, computes needed keys imperatively
  useEffect(() => {
    if (!enabled || visibleFieldIds.length === 0 || recordIds.length === 0) return

    // Clear any pending fetch
    if (pendingFetchRef.current) {
      clearTimeout(pendingFetchRef.current)
    }

    // Schedule new fetch
    pendingFetchRef.current = setTimeout(async () => {
      const neededKeys = computeNeededKeys()
      if (neededKeys.length === 0) return

      const batchId = generateId('batch')
      startLoading(batchId, neededKeys)

      // Group by entityDefinitionId for API calls
      const resourcesByDefinition = new Map<string, RecordId[]>()
      const fieldIds = new Set<string>()

      for (const key of neededKeys) {
        const { recordId, fieldId } = parseFieldValueKey(key)
        const { entityDefinitionId } = parseRecordId(recordId)

        if (!resourcesByDefinition.has(entityDefinitionId)) {
          resourcesByDefinition.set(entityDefinitionId, [])
        }
        resourcesByDefinition.get(entityDefinitionId)!.push(recordId)
        fieldIds.add(fieldId)
      }

      // For table views, assume all recordIds have same entityDefinitionId
      // If multi-definition support needed later, loop over resourcesByDefinition
      const firstRecordId = recordIds[0]
      if (!firstRecordId) return

      const { entityDefinitionId } = parseRecordId(firstRecordId)
      const recordIdsForFetch = resourcesByDefinition.get(entityDefinitionId) ?? []

      try {
        const data = await batchFetch.mutateAsync({
          recordIds: recordIdsForFetch,
          fieldIds: Array.from(fieldIds),
        })

        // Build entries map (API returns RecordId format)
        const entriesMap = new Map(
          data.values.map((v) => [buildFieldValueKey(v.recordId, v.fieldId), v.value])
        )

        // Compute all requested combinations
        const allRequestedCombinations = new Set<FieldValueKey>()
        for (const recordId of recordIdsForFetch) {
          for (const fieldId of fieldIds) {
            allRequestedCombinations.add(buildFieldValueKey(recordId, fieldId))
          }
        }

        // Mark all as loaded
        const allLoadedEntries = Array.from(allRequestedCombinations).map((key) => ({
          key,
          value: entriesMap.get(key) ?? null,
        }))

        setValues(allLoadedEntries)
      } catch (error) {
        console.error('Failed to fetch custom field values:', error)
      } finally {
        finishLoading(batchId)
      }
    }, debounceMs)

    return () => {
      if (pendingFetchRef.current) {
        clearTimeout(pendingFetchRef.current)
      }
    }
  }, [
    enabled,
    visibleFieldIds,
    recordIds,
    debounceMs,
    computeNeededKeys,
    batchFetch,
    startLoading,
    finishLoading,
    setValues,
  ])

  // Get value accessor - reads directly from store via getState (stable function)
  const getValue = useCallback(
    (recordId: RecordId, resourceFieldId: ResourceFieldId): StoredFieldValue | undefined => {
      const { fieldId } = parseResourceFieldId(resourceFieldId)
      const key = buildFieldValueKey(recordId, fieldId)
      return useFieldValueStore.getState().values[key]
    },
    []
  )

  // Loading state accessor
  const isValueLoading = useCallback(
    (recordId: RecordId, resourceFieldId: ResourceFieldId): boolean => {
      const { fieldId } = parseResourceFieldId(resourceFieldId)
      const key = buildFieldValueKey(recordId, fieldId)
      return isKeyLoading(key)
    },
    [isKeyLoading]
  )

  return {
    isFetching: batchFetch.isPending,
    getValue,
    isValueLoading,
  }
}
