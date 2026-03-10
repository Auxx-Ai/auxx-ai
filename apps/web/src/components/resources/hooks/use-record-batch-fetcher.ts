// apps/web/src/components/resources/hooks/use-record-batch-fetcher.ts

import type { RecordId } from '@auxx/lib/resources/client'
import { getDefinitionId, toRecordId } from '@auxx/lib/resources/client'
import { useEffect, useMemo, useState } from 'react'
import { hydrateMultipleRecords } from '~/components/resources/store/hydrate-field-values'
import { api } from '~/trpc/react'
import { getRecordStoreState, type RecordMeta, useRecordStore } from '../store/record-store'
import { useResourceStore } from '../store/resource-store'

const BATCH_DELAY = 50
const EMPTY_ITEMS: RecordId[] = []

/**
 * Hook that subscribes to record store pending fetches and executes them.
 * Fetches mixed RecordIds (multiple entity types) in a single API call.
 * Should be rendered once in ResourceProvider via RecordBatchFetcher component.
 *
 * Pattern: subscribe to pendingFetchIds.size → schedule batch → fetch all types together → distribute to store → hydrate
 */
export function useRecordBatchFetcher() {
  // Get getResourceById from store (stable reference)
  const getResourceById = useResourceStore((s) => s.getResourceById)
  // Track current batch being fetched (mixed RecordIds)
  const [currentBatch, setCurrentBatch] = useState<RecordId[]>([])

  // Subscribe to pending count (triggers re-render when items are added)
  const pendingCount = useRecordStore((s) => s.pendingFetchIds.size)

  // Schedule batch processing when pending items exist
  useEffect(() => {
    if (pendingCount === 0 || currentBatch.length > 0) return

    const timer = setTimeout(() => {
      const recordIds = getRecordStoreState().startBatch()
      if (recordIds.length > 0) {
        setCurrentBatch(recordIds)
      }
    }, BATCH_DELAY)

    return () => clearTimeout(timer)
  }, [pendingCount, currentBatch.length])

  // Stable query input
  const queryItems = useMemo<RecordId[]>(() => {
    return currentBatch.length > 0 ? currentBatch : EMPTY_ITEMS
  }, [currentBatch])

  // Fetch using existing record.getByIds endpoint (handles mixed types)
  const { data, error } = api.record.getByIds.useQuery(
    { items: queryItems },
    {
      enabled: queryItems.length > 0,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    }
  )

  // Handle successful fetch
  useEffect(() => {
    if (!data || currentBatch.length === 0) return

    // Group results by entityDefinitionId for store update
    const byEntityDefinitionId = new Map<string, RecordMeta[]>()
    const foundIds = new Set<RecordId>()

    for (const item of Object.values(data)) {
      const record: RecordMeta = {
        id: item.id,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
        ...item.data,
      }

      const entityDefinitionId = getDefinitionId(item.recordId)

      const list = byEntityDefinitionId.get(entityDefinitionId) ?? []
      list.push(record)
      byEntityDefinitionId.set(entityDefinitionId, list)

      // Track found RecordIds
      foundIds.add(item.recordId)
    }

    // Identify missing items (requested but not returned = deleted/invalid)
    const missingIds = currentBatch.filter((id) => !foundIds.has(id))
    if (missingIds.length > 0) {
      console.debug('[RecordBatchFetcher] Records not found:', missingIds)
    }

    // Update record store (still organized by resourceType internally)
    const store = getRecordStoreState()
    for (const [entityDefinitionId, records] of byEntityDefinitionId) {
      store.setRecords(entityDefinitionId, records)
    }

    // Mark missing items as not found
    if (missingIds.length > 0) {
      store.setNotFound(missingIds)
    }

    // Complete the batch (removes from loadingIds)
    store.completeBatch(currentBatch)

    // Hydrate field values into fieldValueStore
    for (const [entityDefinitionId, records] of byEntityDefinitionId) {
      const resource = getResourceById(entityDefinitionId)
      if (resource) {
        hydrateMultipleRecords(
          resource,
          records.map((r) => ({
            recordId: toRecordId(entityDefinitionId, r.id),
            data: r as Record<string, unknown>,
          }))
        )
      }
    }

    // Clear batch to allow next fetch
    setCurrentBatch([])
  }, [data, currentBatch, getResourceById])

  // Handle error
  useEffect(() => {
    if (!error || currentBatch.length === 0) return

    console.error('[RecordBatchFetcher] Failed to fetch records:', error)

    // Complete batch anyway to prevent infinite retries
    getRecordStoreState().completeBatch(currentBatch)

    // Clear batch to allow next fetch
    setCurrentBatch([])
  }, [error, currentBatch])
}
