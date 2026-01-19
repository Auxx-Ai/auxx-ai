// apps/web/src/components/resources/hooks/use-field-value-syncer.ts

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useFieldValueStore,
  buildFieldValueKey,
  parseFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
  type FieldReference,
} from '~/components/resources/store/field-value-store'
import { type RecordId } from '@auxx/lib/resources/client'
import type { VisibilityState } from '@tanstack/react-table'
import { generateId } from '@auxx/utils/generateId'
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'

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

  /**
   * Column IDs as strings - will be decoded to FieldReferences internally.
   * Can be ResourceFieldId ("contact:email") or encoded path ("a::b").
   */
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
  getValue: (recordId: RecordId, fieldRef: FieldReference) => StoredFieldValue | undefined

  /** Check if a value is currently loading */
  isValueLoading: (recordId: RecordId, fieldRef: FieldReference) => boolean
}

/**
 * Syncer that fetches field values using FieldReference[].
 * Handles both direct fields and relationship paths uniformly.
 *
 * @example
 * ```tsx
 * // Pass resourceFieldIds (can be ResourceFieldId or encoded paths)
 * useFieldValueSyncer({
 *   recordIds,
 *   columnVisibility,
 *   resourceFieldIds: columns.map(c => c.id), // e.g., ['contact:email', 'product:vendor::vendor:name']
 *   enabled: columns.length > 0,
 * })
 * ```
 */
export function useFieldValueSyncer(options: UseFieldValueSyncerOptions): SyncerResult {
  const {
    recordIds,
    columnVisibility,
    resourceFieldIds,
    enabled = true,
    debounceMs = 150,
  } = options

  // Get store actions (stable references)
  const setValues = useFieldValueStore((s) => s.setValues)
  const startLoading = useFieldValueStore((s) => s.startLoading)
  const finishLoading = useFieldValueStore((s) => s.finishLoading)
  // NOTE: Don't subscribe to values/loadingBatches - use getState() imperatively
  // Subscribing would cause re-renders on every value change

  const pendingFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Convert columnIds to FieldReferences, filtering by visibility
  const visibleFieldRefs = useMemo((): FieldReference[] => {
    return resourceFieldIds
      .filter((columnId) => columnVisibility[columnId] !== false)
      .map((columnId) => {
        const decoded = decodeColumnId(columnId)
        if (decoded.type === 'path') {
          return decoded.fieldPath
        }
        return decoded.resourceFieldId
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
    if (!enabled || visibleFieldRefs.length === 0 || recordIds.length === 0) {
      return []
    }

    const { values } = useFieldValueStore.getState()
    const keys: FieldValueKey[] = []

    for (const recordId of recordIds) {
      for (const fieldRef of visibleFieldRefs) {
        const key = buildFieldValueKey(recordId, fieldRef)
        if (!(key in values) && !isKeyLoading(key)) {
          keys.push(key)
        }
      }
    }
    return keys
  }, [enabled, visibleFieldRefs, recordIds, isKeyLoading])

  // Mutation for batch fetching - now uses fieldReferences
  const batchFetch = api.fieldValue.batchGet.useMutation()

  // Debounced fetch trigger - runs when inputs change, computes needed keys imperatively
  useEffect(() => {
    if (!enabled || visibleFieldRefs.length === 0 || recordIds.length === 0) return

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

      // Collect unique recordIds from needed keys
      const recordIdsToFetch = [
        ...new Set(neededKeys.map((key) => parseFieldValueKey(key).recordId)),
      ]

      // Chunk recordIds to avoid API limit
      const chunks = chunkArray(recordIdsToFetch, BATCH_SIZE)

      try {
        // Fetch all chunks in parallel
        const results = await Promise.allSettled(
          chunks.map((chunkRecordIds) =>
            batchFetch.mutateAsync({
              recordIds: chunkRecordIds,
              fieldReferences: visibleFieldRefs, // FieldReference[]
            })
          )
        )

        // Build entries map from all successful results
        const entriesMap = new Map<FieldValueKey, StoredFieldValue>()
        for (const result of results) {
          if (result.status === 'fulfilled') {
            for (const v of result.value.values) {
              // v.fieldRef is FieldReference from backend
              const key = buildFieldValueKey(v.recordId as RecordId, v.fieldRef)
              entriesMap.set(key, v.value)
            }
          } else {
            console.warn('Chunk fetch failed:', result.reason)
          }
        }

        // Compute all requested combinations
        const allRequestedCombinations = new Set<FieldValueKey>()
        for (const recordId of recordIdsToFetch) {
          for (const fieldRef of visibleFieldRefs) {
            allRequestedCombinations.add(buildFieldValueKey(recordId, fieldRef))
          }
        }

        // Mark all as loaded (null for missing values)
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
    visibleFieldRefs,
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
    (recordId: RecordId, fieldRef: FieldReference): StoredFieldValue | undefined => {
      const key = buildFieldValueKey(recordId, fieldRef)
      return useFieldValueStore.getState().values[key]
    },
    []
  )

  // Loading state accessor
  const isValueLoading = useCallback(
    (recordId: RecordId, fieldRef: FieldReference): boolean => {
      const key = buildFieldValueKey(recordId, fieldRef)
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
