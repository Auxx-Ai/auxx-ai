// apps/web/src/components/resources/hooks/use-record.ts

import { useEffect, useRef, useCallback } from 'react'
import { useRecordStore, type RecordMeta } from '../store/record-store'
import type { ResourceRef } from '@auxx/types'

/**
 * Options for useRecord hook.
 * Supports either a ref object or flat props for flexibility.
 */
interface UseRecordOptions {
  /** Resource reference object - alternative to flat props */
  ref?: ResourceRef | null
  /** The entity definition ID (system resource like 'contact' or custom entity UUID) */
  entityDefinitionId?: string | null
  /** The specific instance ID within that entity type */
  entityInstanceId?: string | null
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
 * Tracks requested IDs to prevent infinite loops if fetch fails.
 */
export function useRecord<T extends RecordMeta = RecordMeta>({
  ref,
  entityDefinitionId,
  entityInstanceId,
  enabled = true,
}: UseRecordOptions): UseRecordResult<T> {
  // Support both ref object and flat props
  const defId = ref?.entityDefinitionId ?? entityDefinitionId ?? ''
  const instId = ref?.entityInstanceId ?? entityInstanceId

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
      (state) => state.loadingIds.get(defId)?.has(instId ?? '') ?? false,
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
export function useIsRecordLoading(entityDefinitionId: string, entityInstanceId: string): boolean {
  return useRecordStore(
    useCallback(
      (state) => state.loadingIds.get(entityDefinitionId)?.has(entityInstanceId) ?? false,
      [entityDefinitionId, entityInstanceId]
    )
  )
}

/**
 * Check if a record is pending fetch (queued but not started).
 */
export function useIsRecordPending(entityDefinitionId: string, entityInstanceId: string): boolean {
  return useRecordStore(
    useCallback(
      (state) => state.pendingFetchIds.get(entityDefinitionId)?.has(entityInstanceId) ?? false,
      [entityDefinitionId, entityInstanceId]
    )
  )
}
