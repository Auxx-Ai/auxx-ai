// apps/web/src/components/resources/providers/resource-provider.tsx

'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { getRelationshipStoreState, useRelationshipStore, getRecordStoreState } from '../store'
import { useRecordBatchFetcher } from '../hooks/use-record-batch-fetcher'
import type { Resource, CustomResource } from '@auxx/lib/resources/client'
import { isCustomResource } from '@auxx/lib/resources/client'

interface ResourceContextValue {
  /** Resources (preloaded, includes embedded entity definitions and fields) */
  resources: Resource[]
  /** Custom resources only */
  customResources: CustomResource[]
  /** Loading state for resources */
  isLoadingResources: boolean
  /** Get resource by ID */
  getResourceById: (id: string) => Resource | undefined

  /** Request hydration for relationship items (batch fetched on demand) */
  requestRelationshipHydration: (items: Array<{ resourceId: string; id: string }>) => void
  /** Invalidate specific relationship keys */
  invalidateRelationship: (keys: string[]) => void

  /** Refetch all resources */
  refetch: () => void
}

const ResourceContext = createContext<ResourceContextValue | null>(null)

const BATCH_DELAY = 50
const MAX_RELATIONSHIP_BATCH = 100

/**
 * ResourceProvider - Centralized resource data management
 *
 * Provides:
 * 1. Resources - Unified list of system + custom resources with fields (loaded once upfront)
 * 2. Relationship Items - ResourcePickerItem objects (batch fetched on demand)
 */
export function ResourceProvider({ children }: { children: React.ReactNode }) {
  // === RECORD BATCH FETCHING ===
  // Subscribes to record store and fetches batched records on demand
  useRecordBatchFetcher()

  // === PRELOADED: RESOURCES (with fields embedded) ===
  const resourcesQuery = api.resource.getAllResourceTypes.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Memoize resource lookups
  const resourceMap = useMemo(() => {
    const map = new Map<string, Resource>()
    resourcesQuery.data?.forEach((r) => map.set(r.id, r))
    return map
  }, [resourcesQuery.data])

  // Memoize custom resources filter
  const customResources = useMemo(
    () => (resourcesQuery.data ?? []).filter(isCustomResource),
    [resourcesQuery.data]
  )

  const getResourceById = useCallback((id: string) => resourceMap.get(id), [resourceMap])

  // === RELATIONSHIP ITEMS BATCHING ===
  const [relationshipBatch, setRelationshipBatch] = useState<
    Array<{ resourceId: string; id: string }>
  >([])
  const relationshipPendingSize = useRelationshipStore((s) => s.pendingIds.size)

  useEffect(() => {
    if (relationshipPendingSize === 0 || relationshipBatch.length > 0) return
    const timeout = setTimeout(() => {
      const state = getRelationshipStoreState()
      const items = state.getItemsToFetch().slice(0, MAX_RELATIONSHIP_BATCH)
      if (items.length === 0) return
      const keys = items.map(({ resourceId, id }) => `${resourceId}:${id}`)
      state.markLoading(keys)
      setRelationshipBatch(items)
    }, BATCH_DELAY)
    return () => clearTimeout(timeout)
  }, [relationshipPendingSize, relationshipBatch.length])

  const { data: relationshipData, error: relationshipError } = api.resource.getByIds.useQuery(
    { items: relationshipBatch },
    { enabled: relationshipBatch.length > 0, staleTime: Infinity, refetchOnWindowFocus: false }
  )

  useEffect(() => {
    if (!relationshipData || relationshipBatch.length === 0) return
    // Pass requested keys so missing items (deleted entities) get marked as not found
    const requestedKeys = relationshipBatch.map(({ resourceId, id }) => `${resourceId}:${id}`)
    getRelationshipStoreState().addHydratedItems(relationshipData, requestedKeys)
    setRelationshipBatch([])
  }, [relationshipData, relationshipBatch.length])

  useEffect(() => {
    if (!relationshipError || relationshipBatch.length === 0) return
    console.error('Failed to fetch relationships:', relationshipError)
    const keys = relationshipBatch.map(({ resourceId, id }) => `${resourceId}:${id}`)
    getRelationshipStoreState().markError(keys)
    setRelationshipBatch([])
  }, [relationshipError, relationshipBatch])

  // === METHODS ===
  const requestRelationshipHydration = useCallback(
    (items: Array<{ resourceId: string; id: string }>) => {
      getRelationshipStoreState().requestHydration(items)
    },
    []
  )

  const invalidateRelationship = useCallback((keys: string[]) => {
    getRelationshipStoreState().invalidate(keys)
  }, [])

  const refetch = useCallback(() => {
    resourcesQuery.refetch()
  }, [resourcesQuery])

  const value = useMemo<ResourceContextValue>(
    () => ({
      resources: resourcesQuery.data ?? [],
      customResources,
      isLoadingResources: resourcesQuery.isLoading,
      getResourceById,
      requestRelationshipHydration,
      invalidateRelationship,
      refetch,
    }),
    [
      resourcesQuery.data,
      resourcesQuery.isLoading,
      customResources,
      getResourceById,
      requestRelationshipHydration,
      invalidateRelationship,
      refetch,
    ]
  )

  return <ResourceContext.Provider value={value}>{children}</ResourceContext.Provider>
}

/**
 * Hook to access the ResourceProvider context
 */
export function useResourceProvider() {
  const ctx = useContext(ResourceContext)
  if (!ctx) throw new Error('useResourceProvider must be used within ResourceProvider')
  return ctx
}

/**
 * Clear all resource-related caches.
 * Call on logout or organization switch.
 */
export function clearResourceCaches() {
  getRelationshipStoreState().reset()
  getRecordStoreState().clearAll()
}
