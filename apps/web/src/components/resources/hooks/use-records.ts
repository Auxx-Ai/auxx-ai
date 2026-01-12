// apps/web/src/components/resources/hooks/use-records.ts

import { useEffect, useMemo } from 'react'
import { useRecordStore, type RecordMeta } from '../store/record-store'
import { parseResourceId, type ResourceId } from '@auxx/lib/resources/client'

/**
 * Options for the useRecords hook.
 */
interface UseRecordsOptions {
  /** Array of ResourceIds to fetch (format: "entityDefinitionId:entityInstanceId") */
  resourceIds: ResourceId[]
  /** Disable fetching (default: true when resourceIds.length > 0) */
  enabled?: boolean
}

/**
 * Result returned by the useRecords hook.
 */
interface UseRecordsResult<T = RecordMeta> {
  /** Records in same order as input resourceIds (undefined if not found/not loaded) */
  records: (T | undefined)[]
  /** Quick lookup by ResourceId */
  recordsByKey: Map<ResourceId, T>
  /** True while any records are still loading */
  isLoading: boolean
  /** All requested records found in cache */
  isComplete: boolean
  /** ResourceIds that were not found (deleted/invalid) */
  notFoundIds: ResourceId[]
}

/** Stable empty array for records */
const EMPTY_RECORDS: undefined[] = []
/** Stable empty map for recordsByKey */
const EMPTY_MAP = new Map<ResourceId, RecordMeta>()
/** Stable empty array for notFoundIds */
const EMPTY_NOT_FOUND: ResourceId[] = []

/**
 * Hook for fetching multiple specific records by ResourceId array.
 * Leverages the batch fetcher system for efficient fetching with automatic deduplication.
 *
 * @example
 * // Basic usage
 * const { records, isLoading } = useRecords({
 *   resourceIds: [
 *     toResourceId('contact', 'abc123'),
 *     toResourceId('ticket', 'xyz789'),
 *   ]
 * })
 *
 * @example
 * // With relationship field values
 * const resourceIds = extractRelationshipResourceIds(fieldValue)
 * const { records, isComplete } = useRecords({ resourceIds })
 *
 * @example
 * // Conditional fetching
 * const { records } = useRecords({
 *   resourceIds: selectedResourceIds,
 *   enabled: isPreviewOpen
 * })
 */
export function useRecords<T extends RecordMeta = RecordMeta>({
  resourceIds,
  enabled = true,
}: UseRecordsOptions): UseRecordsResult<T> {
  // Create stable key for dependencies
  const resourceIdsKey = useMemo(() => resourceIds.join(','), [resourceIds])

  // Get request action
  const requestRecord = useRecordStore((s) => s.requestRecord)

  // Request all records via batch system
  useEffect(() => {
    if (!enabled || resourceIds.length === 0) return

    for (const resourceId of resourceIds) {
      requestRecord(resourceId)
    }
  }, [enabled, resourceIdsKey, requestRecord])

  // Subscribe to records from store
  const recordsState = useRecordStore((s) => s.records)
  const loadingIds = useRecordStore((s) => s.loadingIds)
  const pendingIds = useRecordStore((s) => s.pendingFetchIds)
  const notFoundIdsSet = useRecordStore((s) => s.notFoundIds)

  // Resolve records in order
  const records = useMemo(() => {
    if (resourceIds.length === 0) return EMPTY_RECORDS as (T | undefined)[]

    return resourceIds.map((resourceId) => {
      const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)
      return recordsState[entityDefinitionId]?.get(entityInstanceId) as T | undefined
    })
  }, [resourceIds, recordsState, resourceIdsKey])

  // Build lookup map
  const recordsByKey = useMemo(() => {
    if (resourceIds.length === 0) return EMPTY_MAP as Map<ResourceId, T>

    const map = new Map<ResourceId, T>()
    resourceIds.forEach((resourceId, idx) => {
      const record = records[idx]
      if (record) {
        map.set(resourceId, record)
      }
    })
    return map
  }, [resourceIds, records])

  // Check loading state
  const isLoading = useMemo(() => {
    if (resourceIds.length === 0) return false
    return resourceIds.some((id) => loadingIds.has(id) || pendingIds.has(id))
  }, [resourceIds, loadingIds, pendingIds, resourceIdsKey])

  // Check completion state
  const isComplete = useMemo(() => {
    if (resourceIds.length === 0) return true
    return resourceIds.every((resourceId) => {
      const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)
      return (
        recordsState[entityDefinitionId]?.has(entityInstanceId) || notFoundIdsSet.has(resourceId)
      )
    })
  }, [resourceIds, recordsState, notFoundIdsSet, resourceIdsKey])

  // Get not found IDs
  const notFoundIds = useMemo(() => {
    if (resourceIds.length === 0) return EMPTY_NOT_FOUND
    return resourceIds.filter((id) => notFoundIdsSet.has(id))
  }, [resourceIds, notFoundIdsSet, resourceIdsKey])

  return {
    records,
    recordsByKey,
    isLoading,
    isComplete,
    notFoundIds,
  }
}
