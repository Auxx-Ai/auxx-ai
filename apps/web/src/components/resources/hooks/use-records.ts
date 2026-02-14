// apps/web/src/components/resources/hooks/use-records.ts

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { useEffect, useMemo } from 'react'
import { type RecordMeta, useRecordStore } from '../store/record-store'

/**
 * Options for the useRecords hook.
 */
interface UseRecordsOptions {
  /** Array of RecordIds to fetch (format: "entityDefinitionId:entityInstanceId") */
  recordIds: RecordId[]
  /** Disable fetching (default: true when recordIds.length > 0) */
  enabled?: boolean
}

/**
 * Result returned by the useRecords hook.
 */
interface UseRecordsResult<T = RecordMeta> {
  /** Records in same order as input recordIds (undefined if not found/not loaded) */
  records: (T | undefined)[]
  /** Quick lookup by RecordId */
  recordsByKey: Map<RecordId, T>
  /** True while any records are still loading */
  isLoading: boolean
  /** All requested records found in cache */
  isComplete: boolean
  /** RecordIds that were not found (deleted/invalid) */
  notFoundIds: RecordId[]
}

/** Stable empty array for records */
const EMPTY_RECORDS: undefined[] = []
/** Stable empty map for recordsByKey */
const EMPTY_MAP = new Map<RecordId, RecordMeta>()
/** Stable empty array for notFoundIds */
const EMPTY_NOT_FOUND: RecordId[] = []

/**
 * Hook for fetching multiple specific records by RecordId array.
 * Leverages the batch fetcher system for efficient fetching with automatic deduplication.
 *
 * @example
 * // Basic usage
 * const { records, isLoading } = useRecords({
 *   recordIds: [
 *     toRecordId('contact', 'abc123'),
 *     toRecordId('ticket', 'xyz789'),
 *   ]
 * })
 *
 * @example
 * // With relationship field values
 * const recordIds = extractRelationshipRecordIds(fieldValue)
 * const { records, isComplete } = useRecords({ recordIds })
 *
 * @example
 * // Conditional fetching
 * const { records } = useRecords({
 *   recordIds: selectedRecordIds,
 *   enabled: isPreviewOpen
 * })
 */
export function useRecords<T extends RecordMeta = RecordMeta>({
  recordIds,
  enabled = true,
}: UseRecordsOptions): UseRecordsResult<T> {
  // Create stable key for dependencies
  const recordIdsKey = useMemo(() => recordIds.join(','), [recordIds])

  // Get request action
  const requestRecord = useRecordStore((s) => s.requestRecord)

  // Request all records via batch system
  useEffect(() => {
    if (!enabled || recordIds.length === 0) return

    for (const recordId of recordIds) {
      requestRecord(recordId)
    }
  }, [enabled, recordIdsKey, requestRecord])

  // Subscribe to records from store
  const recordsState = useRecordStore((s) => s.records)
  const loadingIds = useRecordStore((s) => s.loadingIds)
  const pendingIds = useRecordStore((s) => s.pendingFetchIds)
  const notFoundIdsSet = useRecordStore((s) => s.notFoundIds)

  // Resolve records in order
  const records = useMemo(() => {
    if (recordIds.length === 0) return EMPTY_RECORDS as (T | undefined)[]

    return recordIds.map((recordId) => {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      return recordsState[entityDefinitionId]?.get(entityInstanceId) as T | undefined
    })
  }, [recordIds, recordsState, recordIdsKey])

  // Build lookup map
  const recordsByKey = useMemo(() => {
    if (recordIds.length === 0) return EMPTY_MAP as Map<RecordId, T>

    const map = new Map<RecordId, T>()
    recordIds.forEach((recordId, idx) => {
      const record = records[idx]
      if (record) {
        map.set(recordId, record)
      }
    })
    return map
  }, [recordIds, records])

  // Check loading state
  const isLoading = useMemo(() => {
    if (recordIds.length === 0) return false
    return recordIds.some((id) => loadingIds.has(id) || pendingIds.has(id))
  }, [recordIds, loadingIds, pendingIds, recordIdsKey])

  // Check completion state
  const isComplete = useMemo(() => {
    if (recordIds.length === 0) return true
    return recordIds.every((recordId) => {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      return recordsState[entityDefinitionId]?.has(entityInstanceId) || notFoundIdsSet.has(recordId)
    })
  }, [recordIds, recordsState, notFoundIdsSet, recordIdsKey])

  // Get not found IDs
  const notFoundIds = useMemo(() => {
    if (recordIds.length === 0) return EMPTY_NOT_FOUND
    return recordIds.filter((id) => notFoundIdsSet.has(id))
  }, [recordIds, notFoundIdsSet, recordIdsKey])

  return {
    records,
    recordsByKey,
    isLoading,
    isComplete,
    notFoundIds,
  }
}
