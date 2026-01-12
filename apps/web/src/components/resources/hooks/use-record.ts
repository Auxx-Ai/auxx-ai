// apps/web/src/components/resources/hooks/use-record.ts

import { useEffect, useRef, useCallback } from 'react'
import { useRecordStore, type RecordMeta } from '../store/record-store'
import { parseResourceId, type ResourceId } from '@auxx/lib/resources/client'

/**
 * Options for useRecord hook.
 */
interface UseRecordOptions {
  /** ResourceId (branded string format: entityDefinitionId:entityInstanceId) */
  resourceId: ResourceId | null | undefined
  /** Disable fetching */
  enabled?: boolean
}

/**
 * Result from useRecord hook
 */
interface UseRecordResult<T> {
  /** The record (from cache) */
  record: T | undefined
  /** Loading state */
  isLoading: boolean
  /** Data came from cache (no fetch needed) */
  isCached: boolean
}

/**
 * Hook for components that need a record with fetch-on-demand.
 * Queues fetch via batching system if record not in cache.
 *
 * @param resourceId - ResourceId in format "entityDefinitionId:entityInstanceId"
 * @param enabled - Whether to enable fetching (default: true)
 *
 * @example
 * const { record } = useRecord({ resourceId: toResourceId('contact', contactId) })
 */
export function useRecord<T extends RecordMeta = RecordMeta>({
  resourceId,
  enabled = true,
}: UseRecordOptions): UseRecordResult<T> {
  // Parse resourceId to get entityDefinitionId and entityInstanceId
  const parsed = resourceId ? parseResourceId(resourceId) : null
  const defId = parsed?.entityDefinitionId ?? ''
  const instId = parsed?.entityInstanceId ?? ''

  // Subscribe to the record
  const record = useRecordStore(
    useCallback(
      (state) => (instId ? (state.records[defId]?.get(instId) as T) : undefined),
      [defId, instId]
    )
  )

  // Subscribe to loading state
  const isLoading = useRecordStore(
    useCallback(
      (state) => state.loadingIds.get(defId)?.has(instId) ?? false,
      [defId, instId]
    )
  )

  // Track IDs we've already requested to prevent infinite loops
  const requestedRef = useRef<Set<string>>(new Set())

  // Get request action
  const requestRecord = useRecordStore((s) => s.requestRecord)

  // Request fetch if not cached and not already requested
  useEffect(() => {
    if (!enabled || !instId || !defId) return
    if (record) return // Already have it
    if (requestedRef.current.has(instId)) return // Already requested

    requestedRef.current.add(instId)
    requestRecord(defId, instId)
  }, [enabled, instId, defId, record, requestRecord])

  // Clear requested set when entityDefinitionId changes
  useEffect(() => {
    requestedRef.current.clear()
  }, [defId])

  return {
    record,
    isLoading: !record && isLoading,
    isCached: !!record,
  }
}

/**
 * Check if a record is currently being loaded.
 */
export function useIsRecordLoading(resourceId: ResourceId): boolean {
  const parsed = parseResourceId(resourceId)
  return useRecordStore(
    useCallback(
      (state) =>
        state.loadingIds.get(parsed.entityDefinitionId)?.has(parsed.entityInstanceId) ?? false,
      [parsed.entityDefinitionId, parsed.entityInstanceId]
    )
  )
}

/**
 * Check if a record is pending fetch (queued but not started).
 */
export function useIsRecordPending(resourceId: ResourceId): boolean {
  const parsed = parseResourceId(resourceId)
  return useRecordStore(
    useCallback(
      (state) =>
        state.pendingFetchIds.get(parsed.entityDefinitionId)?.has(parsed.entityInstanceId) ?? false,
      [parsed.entityDefinitionId, parsed.entityInstanceId]
    )
  )
}
