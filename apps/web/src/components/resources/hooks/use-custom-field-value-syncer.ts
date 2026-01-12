// apps/web/src/hooks/use-custom-field-value-syncer.ts

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useCustomFieldValueStore,
  buildValueKey,
  parseValueKey,
  type ResourceType,
  type StoredFieldValue,
} from '~/components/resources/store/custom-field-value-store'
import type { VisibilityState } from '@tanstack/react-table'
import { generateId } from '@auxx/utils/generateId'

interface UseCustomFieldValueSyncerOptions {
  /** Resource type being displayed */
  resourceType: ResourceType

  /** Entity definition ID (required for 'entity' resourceType) */
  entityDefId?: string

  /** Row IDs currently loaded in the table */
  rowIds: string[]

  /** Column visibility state from DynamicTable */
  columnVisibility: VisibilityState

  /** Custom field column IDs (e.g., ['customField_abc', 'customField_xyz']) */
  customFieldColumnIds: string[]

  /** Whether syncing is enabled */
  enabled?: boolean

  /** Debounce delay in ms (default: 150) */
  debounceMs?: number
}

interface SyncerResult {
  /** Whether a fetch is currently in progress */
  isFetching: boolean

  /** Get a value from the store (returns TypedFieldValue | TypedFieldValue[] | null) */
  getValue: (rowId: string, fieldId: string) => StoredFieldValue | undefined

  /** Check if a value is currently loading */
  isValueLoading: (rowId: string, fieldId: string) => boolean
}

/**
 * Hook that syncs custom field values based on visible columns and rows.
 * Batches requests and deduplicates to minimize API calls.
 */
export function useCustomFieldValueSyncer(options: UseCustomFieldValueSyncerOptions): SyncerResult {
  const {
    resourceType,
    entityDefId,
    rowIds,
    columnVisibility,
    customFieldColumnIds,
    enabled = true,
    debounceMs = 150,
  } = options

  // Get store actions (stable references)
  const setValues = useCustomFieldValueStore((s) => s.setValues)
  const startLoading = useCustomFieldValueStore((s) => s.startLoading)
  const finishLoading = useCustomFieldValueStore((s) => s.finishLoading)
  // NOTE: Don't subscribe to values/loadingBatches - use getState() imperatively
  // Subscribing would cause re-renders on every value change

  const pendingFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Extract field IDs from visible custom field columns
  const visibleFieldIds = useMemo(() => {
    return customFieldColumnIds
      .filter((colId) => columnVisibility[colId] !== false) // visible by default or explicitly true
      .map((colId) => colId.replace('customField_', ''))
  }, [customFieldColumnIds, columnVisibility])

  // Helper to check if a key is loading (uses getState, not subscription)
  const isKeyLoading = useCallback((key: string) => {
    const { loadingBatches } = useCustomFieldValueStore.getState()
    for (const batch of Object.values(loadingBatches)) {
      if (batch.keys.has(key)) return true
    }
    return false
  }, [])

  // Compute needed keys imperatively inside effect (not as reactive dependency)
  const computeNeededKeys = useCallback(() => {
    if (!enabled || visibleFieldIds.length === 0 || rowIds.length === 0) {
      return []
    }

    const { values } = useCustomFieldValueStore.getState()
    const keys: string[] = []
    for (const rowId of rowIds) {
      for (const fieldId of visibleFieldIds) {
        const key = buildValueKey(resourceType, rowId, fieldId, entityDefId)
        if (!(key in values) && !isKeyLoading(key)) {
          keys.push(key)
        }
      }
    }
    return keys
  }, [enabled, visibleFieldIds, rowIds, resourceType, entityDefId, isKeyLoading])

  // Mutation for batch fetching
  const batchFetch = api.fieldValue.batchGet.useMutation()

  // Debounced fetch trigger - runs when inputs change, computes needed keys imperatively
  useEffect(() => {
    if (!enabled || visibleFieldIds.length === 0 || rowIds.length === 0) return

    // Clear any pending fetch
    if (pendingFetchRef.current) {
      clearTimeout(pendingFetchRef.current)
    }

    // Schedule new fetch
    pendingFetchRef.current = setTimeout(async () => {
      // Compute needed keys at fetch time (not as reactive dependency)
      const neededKeys = computeNeededKeys()
      if (neededKeys.length === 0) return

      const batchId = generateId('batch')

      // Mark as loading
      startLoading(batchId, neededKeys)

      // Extract unique resourceIds and fieldIds from keys
      const resourceIds = new Set<string>()
      const fieldIds = new Set<string>()

      for (const key of neededKeys) {
        const parsed = parseValueKey(key)
        resourceIds.add(parsed.resourceId)
        fieldIds.add(parsed.fieldId)
      }

      // Compute all requested combinations (cartesian product)
      const allRequestedCombinations = new Set<string>()
      for (const resourceId of resourceIds) {
        for (const fieldId of fieldIds) {
          const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)
          allRequestedCombinations.add(key)
        }
      }

      try {
        const data = await batchFetch.mutateAsync({
          resourceType,
          entityDefId,
          resourceIds: Array.from(resourceIds),
          fieldIds: Array.from(fieldIds),
        })

        // Update store with fetched TypedFieldValues AND mark all combinations as loaded
        // Entries with actual data from batchGet
        const entriesMap = new Map(
          data.values.map((v) => [
            buildValueKey(resourceType, v.resourceId, v.fieldId, entityDefId),
            v.value,
          ])
        )

        // Mark all requested combinations as loaded (including ones with no data)
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
    rowIds,
    resourceType,
    entityDefId,
    debounceMs,
    computeNeededKeys,
    batchFetch,
    startLoading,
    finishLoading,
    setValues,
  ])

  // Get value accessor - reads directly from store via getState (stable function)
  const getValue = useCallback(
    (rowId: string, fieldId: string): StoredFieldValue | undefined => {
      const key = buildValueKey(resourceType, rowId, fieldId, entityDefId)
      return useCustomFieldValueStore.getState().values[key]
    },
    [resourceType, entityDefId]
  )

  // Loading state accessor
  const isValueLoading = useCallback(
    (rowId: string, fieldId: string): boolean => {
      const key = buildValueKey(resourceType, rowId, fieldId, entityDefId)
      return isKeyLoading(key)
    },
    [resourceType, entityDefId, isKeyLoading]
  )

  return {
    isFetching: batchFetch.isPending,
    getValue,
    isValueLoading,
  }
}
