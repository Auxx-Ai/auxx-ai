// apps/web/src/components/resources/hooks/use-record-with-fetch.ts

import { useEffect, useRef } from 'react'
import { useRecordStore, type RecordMeta } from '../store/record-store'
import { useRecord, useIsRecordLoading } from './use-record'

interface UseRecordWithFetchOptions {
  /** Resource type */
  resourceType: string
  /** Record ID */
  id: string | null | undefined
  /** Disable fetching */
  enabled?: boolean
}

interface UseRecordWithFetchResult<T> {
  /** The record (from cache) */
  record: T | undefined
  /** Loading state */
  isLoading: boolean
  /** Data came from cache (no fetch needed) */
  isCached: boolean
}

/**
 * Hook for drawers and pickers that need fetch-on-demand.
 * Queues fetch via batching system if record not in cache.
 *
 * Unlike useRecord (pure selector), this triggers fetching.
 * Tracks requested IDs to prevent infinite loops if fetch fails.
 */
export function useRecordWithFetch<T extends RecordMeta = RecordMeta>({
  resourceType,
  id,
  enabled = true,
}: UseRecordWithFetchOptions): UseRecordWithFetchResult<T> {
  // Subscribe to the record
  const record = useRecord<T>(resourceType, id)
  const isLoading = useIsRecordLoading(resourceType, id ?? '')

  // Track IDs we've already requested to prevent infinite loops
  const requestedRef = useRef<Set<string>>(new Set())

  // Get request action
  const requestRecord = useRecordStore((s) => s.requestRecord)

  // Request fetch if not cached and not already requested
  useEffect(() => {
    if (!enabled || !id) return
    if (record) return // Already have it
    if (requestedRef.current.has(id)) return // Already requested

    requestedRef.current.add(id)
    requestRecord(resourceType, id)
  }, [enabled, id, record, resourceType, requestRecord])

  // Clear requested set when resourceType changes
  useEffect(() => {
    requestedRef.current.clear()
  }, [resourceType])

  return {
    record,
    isLoading: !record && isLoading,
    isCached: !!record,
  }
}
