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
  /** Loading state (pending or actively fetching) */
  isLoading: boolean
  /** Data came from cache (no fetch needed) */
  isCached: boolean
  /** Record was requested but not found (deleted/invalid) */
  isNotFound: boolean
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

  // Subscribe to loading state (uses Set<ResourceId> now)
  const isLoading = useRecordStore(
    useCallback(
      (state) => (resourceId ? state.loadingIds.has(resourceId) || state.pendingFetchIds.has(resourceId) : false),
      [resourceId]
    )
  )

  // Subscribe to not found state
  const isNotFound = useRecordStore(
    useCallback((state) => (resourceId ? state.notFoundIds.has(resourceId) : false), [resourceId])
  )

  // Track IDs we've already requested to prevent infinite loops
  const requestedRef = useRef<Set<ResourceId>>(new Set())

  // Get request action
  const requestRecord = useRecordStore((s) => s.requestRecord)

  // Request fetch if not cached and not already requested
  useEffect(() => {
    if (!enabled || !resourceId) return
    if (record) return // Already have it
    if (requestedRef.current.has(resourceId)) return // Already requested

    requestedRef.current.add(resourceId)
    requestRecord(resourceId)
  }, [enabled, resourceId, record, requestRecord])

  // Clear requested set when resourceId changes
  useEffect(() => {
    requestedRef.current.clear()
  }, [resourceId])

  return {
    record,
    isLoading: !record && isLoading,
    isCached: !!record,
    isNotFound,
  }
}

/**
 * Check if a record is currently being loaded (pending or fetching).
 */
export function useIsRecordLoading(resourceId: ResourceId): boolean {
  return useRecordStore(
    useCallback(
      (state) => state.loadingIds.has(resourceId) || state.pendingFetchIds.has(resourceId),
      [resourceId]
    )
  )
}

/**
 * Check if a record is pending fetch (queued but not started).
 */
export function useIsRecordPending(resourceId: ResourceId): boolean {
  return useRecordStore(
    useCallback((state) => state.pendingFetchIds.has(resourceId), [resourceId])
  )
}

/**
 * Check if a record was not found (deleted/invalid).
 */
export function useIsRecordNotFound(resourceId: ResourceId): boolean {
  return useRecordStore(
    useCallback((state) => state.notFoundIds.has(resourceId), [resourceId])
  )
}
