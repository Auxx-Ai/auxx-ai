// apps/web/src/hooks/use-custom-field-value-syncer.ts

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  useCustomFieldValueStore,
  buildFieldValueKey,
  parseFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/custom-field-value-store'
import { parseResourceId, type ResourceId } from '@auxx/lib/resources/client'
import type { VisibilityState } from '@tanstack/react-table'
import { generateId } from '@auxx/utils/generateId'
import { toFieldId, type FieldId } from '@auxx/types/field'

interface UseCustomFieldValueSyncerOptions {
  /** ResourceIds for the entities being displayed */
  resourceIds: ResourceId[]

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
  getValue: (resourceId: ResourceId, fieldId: FieldId | string) => StoredFieldValue | undefined

  /** Check if a value is currently loading */
  isValueLoading: (resourceId: ResourceId, fieldId: FieldId | string) => boolean
}

/**
 * Hook that syncs custom field values based on visible columns and rows.
 * Batches requests and deduplicates to minimize API calls.
 */
export function useCustomFieldValueSyncer(options: UseCustomFieldValueSyncerOptions): SyncerResult {
  const {
    resourceIds,
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
  const isKeyLoading = useCallback((key: FieldValueKey) => {
    const { loadingBatches } = useCustomFieldValueStore.getState()
    for (const batch of Object.values(loadingBatches)) {
      if (batch.keys.has(key)) return true
    }
    return false
  }, [])

  // Compute needed keys imperatively inside effect (not as reactive dependency)
  const computeNeededKeys = useCallback(() => {
    if (!enabled || visibleFieldIds.length === 0 || resourceIds.length === 0) {
      return []
    }

    const { values } = useCustomFieldValueStore.getState()
    const keys: FieldValueKey[] = []

    for (const resourceId of resourceIds) {
      for (const fieldId of visibleFieldIds) {
        const key = buildFieldValueKey(resourceId, fieldId)
        if (!(key in values) && !isKeyLoading(key)) {
          keys.push(key)
        }
      }
    }
    return keys
  }, [enabled, visibleFieldIds, resourceIds, isKeyLoading])

  // Mutation for batch fetching
  const batchFetch = api.fieldValue.batchGet.useMutation()

  // Debounced fetch trigger - runs when inputs change, computes needed keys imperatively
  useEffect(() => {
    if (!enabled || visibleFieldIds.length === 0 || resourceIds.length === 0) return

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
      const resourcesByDefinition = new Map<string, ResourceId[]>()
      const fieldIds = new Set<string>()

      for (const key of neededKeys) {
        const { resourceId, fieldId } = parseFieldValueKey(key)
        const { entityDefinitionId } = parseResourceId(resourceId)

        if (!resourcesByDefinition.has(entityDefinitionId)) {
          resourcesByDefinition.set(entityDefinitionId, [])
        }
        resourcesByDefinition.get(entityDefinitionId)!.push(resourceId)
        fieldIds.add(fieldId)
      }

      // For table views, assume all resourceIds have same entityDefinitionId
      // If multi-definition support needed later, loop over resourcesByDefinition
      const firstResourceId = resourceIds[0]
      if (!firstResourceId) return

      const { entityDefinitionId } = parseResourceId(firstResourceId)
      const resourceIdsForFetch = resourcesByDefinition.get(entityDefinitionId) ?? []

      try {
        const data = await batchFetch.mutateAsync({
          resourceIds: resourceIdsForFetch,
          fieldIds: Array.from(fieldIds),
        })

        // Build entries map (API returns ResourceId format)
        const entriesMap = new Map(
          data.values.map((v) => [buildFieldValueKey(v.resourceId, v.fieldId), v.value])
        )

        // Compute all requested combinations
        const allRequestedCombinations = new Set<FieldValueKey>()
        for (const resourceId of resourceIdsForFetch) {
          for (const fieldId of fieldIds) {
            allRequestedCombinations.add(buildFieldValueKey(resourceId, fieldId))
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
    resourceIds,
    debounceMs,
    computeNeededKeys,
    batchFetch,
    startLoading,
    finishLoading,
    setValues,
  ])

  // Get value accessor - reads directly from store via getState (stable function)
  const getValue = useCallback(
    (resourceId: ResourceId, fieldId: FieldId | string): StoredFieldValue | undefined => {
      const typedFieldId = typeof fieldId === 'string' ? toFieldId(fieldId) : fieldId
      const key = buildFieldValueKey(resourceId, typedFieldId)
      return useCustomFieldValueStore.getState().values[key]
    },
    [],
  )

  // Loading state accessor
  const isValueLoading = useCallback(
    (resourceId: ResourceId, fieldId: FieldId | string): boolean => {
      const typedFieldId = typeof fieldId === 'string' ? toFieldId(fieldId) : fieldId
      const key = buildFieldValueKey(resourceId, typedFieldId)
      return isKeyLoading(key)
    },
    [isKeyLoading],
  )

  return {
    isFetching: batchFetch.isPending,
    getValue,
    isValueLoading,
  }
}
