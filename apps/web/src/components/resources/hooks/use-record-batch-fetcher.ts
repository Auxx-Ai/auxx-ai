// apps/web/src/components/resources/hooks/use-record-batch-fetcher.ts

import { useEffect, useState, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useRecordStore, getRecordStoreState, type RecordMeta } from '../store/record-store'
import { useResourceStore } from '../store/resource-store'
import { hydrateMultipleRecords } from '~/components/resources/store/hydrate-field-values'
import type { ResourceId } from '@auxx/lib/resources/client'
import { toResourceId, getDefinitionId } from '@auxx/lib/resources/client'

const BATCH_DELAY = 50
const EMPTY_ITEMS: ResourceId[] = []

/**
 * Hook that subscribes to record store pending fetches and executes them.
 * Fetches mixed ResourceIds (multiple entity types) in a single API call.
 * Should be rendered once in ResourceProvider via RecordBatchFetcher component.
 *
 * Pattern: subscribe to pendingFetchIds.size → schedule batch → fetch all types together → distribute to store → hydrate
 */
export function useRecordBatchFetcher() {
  // Get getResourceById from store (stable reference)
  const getResourceById = useResourceStore((s) => s.getResourceById)
  // Track current batch being fetched (mixed ResourceIds)
  const [currentBatch, setCurrentBatch] = useState<ResourceId[]>([])

  // Subscribe to pending count (triggers re-render when items are added)
  const pendingCount = useRecordStore((s) => s.pendingFetchIds.size)

  // Schedule batch processing when pending items exist
  useEffect(() => {
    if (pendingCount === 0 || currentBatch.length > 0) return

    const timer = setTimeout(() => {
      const resourceIds = getRecordStoreState().startBatch()
      if (resourceIds.length > 0) {
        setCurrentBatch(resourceIds)
      }
    }, BATCH_DELAY)

    return () => clearTimeout(timer)
  }, [pendingCount, currentBatch.length])

  // Stable query input
  const queryItems = useMemo<ResourceId[]>(() => {
    return currentBatch.length > 0 ? currentBatch : EMPTY_ITEMS
  }, [currentBatch])

  // Fetch using existing resource.getByIds endpoint (handles mixed types)
  const { data, error } = api.resource.getByIds.useQuery(
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
    const foundIds = new Set<ResourceId>()

    for (const item of Object.values(data)) {
      const record: RecordMeta = {
        id: item.id,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
        ...item.data,
      }

      const entityDefinitionId = getDefinitionId(item.resourceId)

      const list = byEntityDefinitionId.get(entityDefinitionId) ?? []
      list.push(record)
      byEntityDefinitionId.set(entityDefinitionId, list)

      // Track found ResourceIds
      foundIds.add(item.resourceId)
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

    // Hydrate field values into customFieldValueStore
    for (const [entityDefinitionId, records] of byEntityDefinitionId) {
      const resource = getResourceById(entityDefinitionId)
      if (resource) {
        hydrateMultipleRecords(
          resource,
          records.map((r) => ({
            resourceId: toResourceId(entityDefinitionId, r.id),
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
