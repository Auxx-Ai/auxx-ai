// apps/web/src/components/resources/hooks/use-record.ts

import { useCallback } from 'react'
import { useRecordStore, type RecordMeta } from '../store/record-store'

/**
 * Pure selector hook - subscribes to a single record by ID.
 * Only re-renders when THIS specific record changes.
 *
 * Use this in table rows for row-level reactivity:
 * - Parent passes ID
 * - Row subscribes to its own record
 * - Other rows don't re-render when this record changes
 *
 * For fetch-on-demand (drawers, pickers), use useRecordWithFetch instead.
 */
export function useRecord<T extends RecordMeta = RecordMeta>(
  resourceType: string,
  id: string | null | undefined
): T | undefined {
  return useRecordStore(
    useCallback(
      (state) => (id ? (state.records[resourceType]?.get(id) as T) : undefined),
      [resourceType, id]
    )
  )
}

/**
 * Check if a record is currently being loaded.
 */
export function useIsRecordLoading(resourceType: string, id: string): boolean {
  return useRecordStore(
    useCallback(
      (state) => state.loadingIds.get(resourceType)?.has(id) ?? false,
      [resourceType, id]
    )
  )
}

/**
 * Check if a record is pending fetch (queued but not started).
 */
export function useIsRecordPending(resourceType: string, id: string): boolean {
  return useRecordStore(
    useCallback(
      (state) => state.pendingFetchIds.get(resourceType)?.has(id) ?? false,
      [resourceType, id]
    )
  )
}
