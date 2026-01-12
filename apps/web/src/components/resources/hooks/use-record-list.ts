// apps/web/src/components/resources/hooks/use-record-list.ts

import { useEffect, useMemo, useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import {
  useRecordStore,
  createListKey,
  isListStale,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  type RecordMeta,
} from '../store/record-store'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { toResourceId } from '@auxx/lib/resources/client'

/** Stable empty array for default return */
const EMPTY_IDS: string[] = []

interface UseRecordListOptions {
  /** Resource type (e.g., 'contact', 'ticket', 'entity_abc') */
  resourceType: string
  /** Filter conditions - pass undefined or stable reference, NOT [] */
  filters?: ConditionGroup[]
  /** Sorting config - pass undefined or stable reference, NOT [] */
  sorting?: Array<{ id: string; desc: boolean }>
  /** Items per page */
  limit?: number
  /** Disable fetching */
  enabled?: boolean
}

interface UseRecordListResult<T = RecordMeta> {
  /** Record IDs for current page - rows use useRecord(id) individually */
  recordIds: string[]
  /** Resolved items from record store (may be partial while loading) */
  items: T[]
  /** True if records are still being fetched */
  isLoadingRecords: boolean
  /** The list key (for cache reference) */
  listKey: string
  /** Total matching count */
  total: number
  /** Loading initial data */
  isLoading: boolean
  /** Loading more data */
  isFetchingNextPage: boolean
  /** More pages available */
  hasNextPage: boolean
  /** Load next page */
  fetchNextPage: () => void
  /** Force refresh */
  refresh: () => void
  /** Data came from cache */
  isCached: boolean
  /** Snapshot ID for pagination */
  snapshotId: string | null
}

/**
 * Hook to fetch and cache a filtered/sorted list of record IDs.
 * Returns record IDs - each row should use useRecord(id) for its data.
 *
 * Uses useInfiniteQuery for cursor-based pagination with server-side snapshots.
 * The cursor is a typed object { snapshotId, offset } for type safety.
 *
 * This pattern enables row-level reactivity:
 * - Only the row whose record changed will re-render
 * - Other rows maintain stable references via immer
 *
 * IMPORTANT: Do NOT pass [] or {} as defaults - use undefined instead.
 */
export function useRecordList<T extends RecordMeta = RecordMeta>({
  resourceType,
  filters,
  sorting,
  limit = 50,
  enabled = true,
}: UseRecordListOptions): UseRecordListResult<T> {
  // Use stable empty defaults to prevent infinite loops
  const stableFilters = filters ?? EMPTY_FILTERS
  const stableSorting = sorting ?? EMPTY_SORTING

  // Create stable list key for store caching
  const listKey = useMemo(
    () => createListKey(resourceType, stableFilters, stableSorting),
    [resourceType, stableFilters, stableSorting]
  )

  // Track snapshotId for use after initial fetch
  const snapshotIdRef = useRef<string | null>(null)

  // ─── SELECTORS ─────────────────────────────────────────────────────
  // Check if we have a valid cache before fetching

  const listCache = useRecordStore((s) => s.lists[listKey])
  const cachedList = listCache && !isListStale(listCache) ? listCache : undefined

  // Select action functions (stable references)
  const setList = useRecordStore((s) => s.setList)

  // ─── INFINITE QUERY ────────────────────────────────────────────────
  // Uses cursor-based pagination with typed cursor object { snapshotId, offset }

  const shouldFetch = enabled && !cachedList

  // Stable query input to prevent infinite loops
  const queryInput = useMemo(
    () => ({
      entityDefinitionId: resourceType,
      filters: stableFilters.length > 0 ? stableFilters : undefined,
      sorting: stableSorting.length > 0 ? stableSorting : undefined,
      limit,
    }),
    [resourceType, stableFilters, stableSorting, limit]
  )

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage: fetchNextPageRaw,
    refetch,
  } = api.resource.listFiltered.useInfiniteQuery(queryInput, {
    enabled: shouldFetch,
    staleTime: 30_000,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore || !lastPage.snapshotId) return undefined
      // Calculate total IDs fetched so far across all pages
      const totalFetched = allPages.reduce((sum, page) => sum + page.ids.length, 0)
      return { snapshotId: lastPage.snapshotId, offset: totalFetched }
    },
  })

  // Get request action for batch fetching
  const requestRecord = useRecordStore((s) => s.requestRecord)

  // ─── SYNC TO STORE + QUEUE RECORD FETCHES ────────────────────────
  useEffect(() => {
    if (!data?.pages?.length) return

    // Flatten all pages into IDs with deduplication (preserves order)
    const seenIds = new Set<string>()
    const allIds: string[] = []

    for (const page of data.pages) {
      if (page.ids) {
        for (const id of page.ids) {
          if (!seenIds.has(id)) {
            seenIds.add(id)
            allIds.push(id)
          }
        }
      }
    }

    // Get snapshot ID from first page
    const firstPage = data.pages[0]
    if (firstPage?.snapshotId) {
      snapshotIdRef.current = firstPage.snapshotId
    }

    const lastPage = data.pages[data.pages.length - 1]

    // Store uses nextCursor to track if more pages exist (value doesn't matter, just presence)
    const nextCursor = lastPage?.hasMore ? 'more' : null

    setList(listKey, {
      ids: allIds,
      total: lastPage?.total ?? allIds.length,
      fetchedAt: Date.now(),
      nextCursor,
    })

    // Queue record fetches for IDs not in cache
    const recordCache = useRecordStore.getState().records[resourceType]
    for (const id of allIds) {
      if (!recordCache?.has(id)) {
        requestRecord(toResourceId(resourceType, id))
      }
    }
  }, [data, listKey, setList, resourceType, requestRecord])

  // ─── FETCH NEXT PAGE ────────────────────────────────────────────────

  const fetchNextPage = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) {
      fetchNextPageRaw()
    }
  }, [fetchNextPageRaw, isFetchingNextPage, hasNextPage])

  // ─── REFRESH ───────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    useRecordStore.getState().invalidateList(listKey)
    snapshotIdRef.current = null
    refetch()
  }, [listKey, refetch])

  // ─── RETURN ────────────────────────────────────────────────────────
  // Return IDs and resolved items from record store

  // Prefer cached data if available
  const recordIds = cachedList?.ids ?? (data?.pages?.flatMap((p: { ids: string[] }) => p.ids) || EMPTY_IDS)
  const total = cachedList?.total ?? data?.pages?.[data.pages.length - 1]?.total ?? 0

  // ─── RESOLVE ITEMS FROM RECORD STORE ─────────────────────────────────
  // Subscribe to record cache for this resource type
  const recordCache = useRecordStore((s) => s.records[resourceType])
  const loadingIds = useRecordStore((s) => s.loadingIds)
  const pendingIds = useRecordStore((s) => s.pendingFetchIds)

  // Resolve items from cache - filter out undefined (not yet loaded)
  const items = useMemo(() => {
    if (!recordCache) return [] as T[]
    return recordIds
      .map((id: string) => recordCache.get(id) as T | undefined)
      .filter((item: T | undefined): item is T => item !== undefined)
  }, [recordCache, recordIds])

  // Check if any records are still loading
  const isLoadingRecords = useMemo(() => {
    if (!recordIds.length) return false
    // Records are loading if we have fewer items than IDs, and some are pending/loading
    if (items.length < recordIds.length) {
      const hasLoading = recordIds.some((id: string) => {
        const resourceId = toResourceId(resourceType, id)
        return loadingIds.has(resourceId) || pendingIds.has(resourceId)
      })
      return hasLoading
    }
    return false
  }, [recordIds, items.length, loadingIds, pendingIds, resourceType])

  return {
    recordIds,
    items,
    isLoadingRecords,
    listKey,
    total,
    isLoading: shouldFetch && isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? (cachedList?.nextCursor !== null),
    fetchNextPage,
    refresh,
    isCached: !!cachedList,
    snapshotId: snapshotIdRef.current,
  }
}
