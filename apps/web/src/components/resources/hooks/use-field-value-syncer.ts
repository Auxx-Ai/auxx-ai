// apps/web/src/components/resources/hooks/use-field-value-syncer.ts

import { useEffect, useMemo, useRef, useCallback } from 'react'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type StoredFieldValue,
  type FieldReference,
} from '~/components/resources/store/field-value-store'
import { fieldValueFetchQueue } from '~/components/resources/store/field-value-fetch-queue'
import { type RecordId } from '@auxx/lib/resources/client'
import type { VisibilityState } from '@tanstack/react-table'
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'

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
  const { recordIds, columnVisibility, resourceFieldIds, enabled = true, debounceMs = 150 } = options

  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Convert columnIds to FieldReferences, filtering by visibility
  const visibleFieldRefs = useMemo((): FieldReference[] => {
    return resourceFieldIds
      .filter((columnId) => columnVisibility[columnId] !== false)
      .map((columnId) => {
        const decoded = decodeColumnId(columnId)
        return decoded.type === 'path' ? decoded.fieldPath : decoded.resourceFieldId
      })
  }, [resourceFieldIds, columnVisibility])

  // Debounced queue trigger - delegates to shared fetch queue
  useEffect(() => {
    if (!enabled || visibleFieldRefs.length === 0 || recordIds.length === 0) return

    if (pendingRef.current) clearTimeout(pendingRef.current)

    pendingRef.current = setTimeout(() => {
      // Build all (recordId, fieldRef) combinations and queue them
      const requests: Array<{ recordId: RecordId; fieldRef: FieldReference }> = []
      for (const recordId of recordIds) {
        for (const fieldRef of visibleFieldRefs) {
          requests.push({ recordId, fieldRef })
        }
      }
      fieldValueFetchQueue.queueFetchBatch(requests)
    }, debounceMs)

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current)
    }
  }, [enabled, visibleFieldRefs, recordIds, debounceMs])

  // Get value accessor - reads directly from store via getState (stable function)
  const getValue = useCallback(
    (recordId: RecordId, fieldRef: FieldReference): StoredFieldValue | undefined => {
      const key = buildFieldValueKey(recordId, fieldRef)
      return useFieldValueStore.getState().values[key]
    },
    []
  )

  // Loading state accessor
  const isValueLoading = useCallback((recordId: RecordId, fieldRef: FieldReference): boolean => {
    const key = buildFieldValueKey(recordId, fieldRef)
    return useFieldValueStore.getState().isKeyLoading(key)
  }, [])

  return { isFetching: false, getValue, isValueLoading }
}
