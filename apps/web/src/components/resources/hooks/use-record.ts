// apps/web/src/components/resources/hooks/use-record.ts

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { type RecordMeta, useRecordStore } from '../store/record-store'
import { useNormalizedRecordId } from '../utils/normalize-record-id'

/**
 * Options for useRecord hook.
 */
interface UseRecordOptions {
  /** RecordId (branded string format: entityDefinitionId:entityInstanceId) */
  recordId: RecordId | null | undefined
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
  /** A fetch attempt has completed (found or not-found). False on first render before the batch fetcher resolves. */
  hasLoadedOnce: boolean
}

/**
 * Hook for components that need a record with fetch-on-demand.
 * Queues fetch via batching system if record not in cache.
 *
 * @param recordId - RecordId in format "entityDefinitionId:entityInstanceId"
 * @param enabled - Whether to enable fetching (default: true)
 *
 * @example
 * const { record } = useRecord({ recordId: toRecordId('contact', contactId) })
 */
export function useRecord<T extends RecordMeta = RecordMeta>({
  recordId,
  enabled = true,
}: UseRecordOptions): UseRecordResult<T> {
  // Normalize the recordId prefix so both `contact:<id>` and `<UUID>:<id>`
  // forms resolve to the same cache slot and batch request key.
  const normalizedRecordId = useNormalizedRecordId(recordId)

  // Parse recordId to get entityDefinitionId and entityInstanceId
  const parsed = normalizedRecordId ? parseRecordId(normalizedRecordId) : null
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
      (state) =>
        normalizedRecordId
          ? state.loadingIds.has(normalizedRecordId) ||
            state.pendingFetchIds.has(normalizedRecordId)
          : false,
      [normalizedRecordId]
    )
  )

  // Subscribe to not found state
  const isNotFound = useRecordStore(
    useCallback(
      (state) => (normalizedRecordId ? state.notFoundIds.has(normalizedRecordId) : false),
      [normalizedRecordId]
    )
  )

  // Subscribe to "we've completed at least one fetch attempt" state
  const hasLoadedOnce = useRecordStore(
    useCallback(
      (state) => (normalizedRecordId ? state.attemptedIds.has(normalizedRecordId) : false),
      [normalizedRecordId]
    )
  )

  // Track IDs we've already requested to prevent duplicate requests
  const requestedRef = useRef<Set<RecordId>>(new Set())

  // Get request action (stable reference from store)
  const requestRecord = useRecordStore((s) => s.requestRecord)

  // Request fetch in useLayoutEffect - runs synchronously before paint
  // This prevents the flicker where the component renders with isLoading=false
  useLayoutEffect(() => {
    if (!enabled || !normalizedRecordId) return
    if (record) return
    if (requestedRef.current.has(normalizedRecordId)) return

    requestedRef.current.add(normalizedRecordId)
    requestRecord(normalizedRecordId)
  }, [enabled, normalizedRecordId, record, requestRecord])

  // Clear requested set when recordId changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: normalizedRecordId triggers clearing the requested set
  useEffect(() => {
    requestedRef.current.clear()
  }, [normalizedRecordId])

  return {
    record,
    isLoading: !record && isLoading,
    isCached: !!record,
    isNotFound,
    hasLoadedOnce,
  }
}

/**
 * Check if a record is currently being loaded (pending or fetching).
 */
export function useIsRecordLoading(recordId: RecordId): boolean {
  return useRecordStore(
    useCallback(
      (state) => state.loadingIds.has(recordId) || state.pendingFetchIds.has(recordId),
      [recordId]
    )
  )
}

/**
 * Check if a record is pending fetch (queued but not started).
 */
export function useIsRecordPending(recordId: RecordId): boolean {
  return useRecordStore(useCallback((state) => state.pendingFetchIds.has(recordId), [recordId]))
}

/**
 * Check if a record was not found (deleted/invalid).
 */
export function useIsRecordNotFound(recordId: RecordId): boolean {
  return useRecordStore(useCallback((state) => state.notFoundIds.has(recordId), [recordId]))
}
