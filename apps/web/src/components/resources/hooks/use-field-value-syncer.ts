// apps/web/src/components/resources/hooks/use-field-value-syncer.ts

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

/** Maximum number of recordIds per API call */
const BATCH_SIZE = 100

/**
 * Split an array into chunks of specified size.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

interface UseFieldValueSyncerOptions {
  /** RecordIds for the entities being displayed */
  recordIds: RecordId[]

  /** Column visibility state from DynamicTable */
  columnVisibility: VisibilityState

  /** ResourceFieldIds for columns (e.g., ['contact:email', 'contact:abc']) */
  resourceFieldIds: ResourceFieldId[]

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
 * Hook that syncs field values based on visible columns and rows.
 * Batches requests and deduplicates to minimize API calls.
 *
 * @example
 * ```tsx
 * // Pass resourceFieldIds in ResourceFieldId format
 * useFieldValueSyncer({
 *   recordIds,
 *   columnVisibility,
 *   resourceFieldIds: customFields.map(f => f.resourceFieldId),
 *   enabled: customFields.length > 0,
 * })
 * ```
 */
export function useFieldValueSyncer(options: UseFieldValueSyncerOptions): SyncerResult {
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

      // Group by entityDefinitionId for API calls (use Set to avoid duplicate recordIds)
      const resourcesByDefinition = new Map<string, Set<RecordId>>()
      const fieldIds = new Set<string>()

      for (const key of neededKeys) {
        const { recordId, fieldId } = parseFieldValueKey(key)
        const { entityDefinitionId } = parseRecordId(recordId)

        if (!resourcesByDefinition.has(entityDefinitionId)) {
          resourcesByDefinition.set(entityDefinitionId, new Set())
        }
        resourcesByDefinition.get(entityDefinitionId)!.add(recordId)
        fieldIds.add(fieldId)
      }

      // For table views, assume all recordIds have same entityDefinitionId
      // If multi-definition support needed later, loop over resourcesByDefinition
      const firstRecordId = recordIds[0]
      if (!firstRecordId) return

      const { entityDefinitionId } = parseRecordId(firstRecordId)
      const recordIdsForFetch = [...(resourcesByDefinition.get(entityDefinitionId) ?? [])]

      // Chunk recordIds to avoid API limit
      const chunks = chunkArray(recordIdsForFetch, BATCH_SIZE)
      const fieldIdsArray = Array.from(fieldIds)

      try {
        // Fetch all chunks in parallel
        const results = await Promise.allSettled(
          chunks.map((chunkRecordIds) =>
            batchFetch.mutateAsync({
              recordIds: chunkRecordIds,
              fieldIds: fieldIdsArray,
            })
          )
        )

        // Build entries map from all successful results
        const entriesMap = new Map<FieldValueKey, StoredFieldValue>()
        for (const result of results) {
          if (result.status === 'fulfilled') {
            for (const v of result.value.values) {
              entriesMap.set(buildFieldValueKey(v.recordId, v.fieldId), v.value)
            }
          } else {
            console.warn('Chunk fetch failed:', result.reason)
          }
        }

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
        console.error('Failed to fetch field values:', error)
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
