// apps/web/src/components/resources/hooks/use-record-batch-fetcher.ts

import { useEffect, useState, useRef, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useRecordStore, getRecordStoreState } from '../store/record-store'
import { hydrateMultipleRecords } from '~/stores/hydrate-field-values'
import type { Resource } from '@auxx/lib/resources/client'
import type { ResourceRef } from '@auxx/types/resource'

const BATCH_DELAY = 50
const EMPTY_ITEMS: ResourceRef[] = []

interface UseRecordBatchFetcherOptions {
  /** Function to get Resource by ID (from ResourceProvider context) */
  getResourceById: (id: string) => Resource | undefined
}

/**
 * Hook that subscribes to record store pending fetches and executes them.
 * Uses existing resource.getByIds endpoint.
 * Should be rendered once in ResourceProvider via RecordBatchFetcher component.
 *
 * Pattern: subscribe to pendingFetchIds size → schedule batch → fetch → sync to store → hydrate to field value store
 */
export function useRecordBatchFetcher({ getResourceById }: UseRecordBatchFetcherOptions) {
  // Track current batch being fetched: { resourceType, ids }
  const [currentBatch, setCurrentBatch] = useState<{
    resourceType: string
    ids: string[]
  } | null>(null)

  // Track which resource types have pending timers
  const pendingTimersRef = useRef<Set<string>>(new Set())

  // Subscribe to pending fetch IDs to detect when batches are ready
  const pendingFetchIds = useRecordStore((s) => s.pendingFetchIds)

  // Schedule batch processing when pending IDs change
  useEffect(() => {
    // If already fetching, wait
    if (currentBatch) return

    // Find resource types with pending IDs
    for (const [resourceType, pendingSet] of pendingFetchIds) {
      if (pendingSet.size === 0) continue
      if (pendingTimersRef.current.has(resourceType)) continue

      // Schedule batch after delay
      pendingTimersRef.current.add(resourceType)

      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(resourceType)

        // Get batch from store
        const ids = getRecordStoreState().startBatch(resourceType)
        if (ids.length > 0) {
          setCurrentBatch({ resourceType, ids })
        }
      }, BATCH_DELAY)

      // Only schedule one resource type at a time
      return () => {
        clearTimeout(timer)
        pendingTimersRef.current.delete(resourceType)
      }
    }
  }, [pendingFetchIds, currentBatch])

  // Stable query input - memoize to prevent creating new arrays
  const queryItems = useMemo<ResourceRef[]>(() => {
    if (!currentBatch || currentBatch.ids.length === 0) return EMPTY_ITEMS
    return currentBatch.ids.map((id) => ({
      entityDefinitionId: currentBatch.resourceType,
      entityInstanceId: id,
    }))
  }, [currentBatch])

  // Fetch current batch using existing resource.getByIds endpoint
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
    if (!data || !currentBatch) return

    const { resourceType, ids } = currentBatch

    // Extract data field from ResourcePickerItem and build records
    const records = Object.values(data).map((item) => ({
      id: item.id,
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
      ...item.data,
    }))

    // Sync to record store
    const store = getRecordStoreState()
    store.setRecords(resourceType, records)
    store.completeBatch(resourceType, ids)

    // Hydrate field values into customFieldValueStore
    // This enables CustomFieldCell to access all field values (system + custom)
    const resource = getResourceById(resourceType)
    if (resource) {
      hydrateMultipleRecords(
        resource,
        records.map((r) => ({ id: r.id, data: r as Record<string, unknown> }))
      )
    }

    // Clear batch to allow next fetch
    setCurrentBatch(null)
  }, [data, currentBatch, getResourceById])

  // Handle error
  useEffect(() => {
    if (!error || !currentBatch) return

    console.error(`Failed to fetch ${currentBatch.resourceType} records:`, error)

    // Complete batch anyway to prevent infinite retries
    const { resourceType, ids } = currentBatch
    getRecordStoreState().completeBatch(resourceType, ids)

    // Clear batch to allow next fetch
    setCurrentBatch(null)
  }, [error, currentBatch])
}
