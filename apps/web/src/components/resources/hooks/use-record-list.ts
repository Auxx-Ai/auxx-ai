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

interface UseRecordListResult {
  /** Record IDs for current page - rows use useRecord(id) individually */
  recordIds: string[]
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
 * Encode pagination cursor from snapshotId and offset
 */
function encodeCursor(snapshotId: string, offset: number): string {
  return `${snapshotId}:${offset}`
}

/**
 * Decode pagination cursor to snapshotId and offset
 */
function decodeCursor(cursor: string): { snapshotId: string; offset: number } | null {
  const colonIndex = cursor.lastIndexOf(':')
  if (colonIndex === -1) return null
  const snapshotId = cursor.slice(0, colonIndex)
  const offset = parseInt(cursor.slice(colonIndex + 1), 10)
  if (isNaN(offset)) return null
  return { snapshotId, offset }
}

/**
 * Hook to fetch and cache a filtered/sorted list of record IDs.
 * Returns record IDs - each row should use useRecord(id) for its data.
 *
 * Uses useInfiniteQuery for cursor-based pagination with server-side snapshots.
 * The snapshot is created on first fetch and encoded in the cursor for consistency.
 *
 * This pattern enables row-level reactivity:
 * - Only the row whose record changed will re-render
 * - Other rows maintain stable references via immer
 *
 * IMPORTANT: Do NOT pass [] or {} as defaults - use undefined instead.
 */
export function useRecordList({
  resourceType,
  filters,
  sorting,
  limit = 50,
  enabled = true,
}: UseRecordListOptions): UseRecordListResult {
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
  const appendToList = useRecordStore((s) => s.appendToList)

  // ─── INFINITE QUERY ────────────────────────────────────────────────
  // Uses cursor-based pagination. Server creates snapshot on first call,
  // encodes snapshotId + offset in cursor for subsequent pages.

  const shouldFetch = enabled && !cachedList

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage: fetchNextPageRaw,
    refetch,
  } = api.resource.listFiltered.useInfiniteQuery(
    {
      tableId: resourceType,
      filters: stableFilters.length > 0 ? stableFilters : undefined,
      sorting: stableSorting.length > 0 ? stableSorting : undefined,
      limit,
    },
    {
      enabled: shouldFetch,
      staleTime: 30_000,
      getNextPageParam: (lastPage) => {
        if (!lastPage.hasMore || !lastPage.snapshotId) return undefined
        // Calculate next offset based on current data
        const nextOffset = (lastPage as any).currentOffset ?? 0
        return encodeCursor(lastPage.snapshotId, nextOffset + lastPage.ids.length)
      },
      // Transform input for subsequent pages
      queryFn: undefined, // Let tRPC handle it
    }
  )

  // ─── SYNC TO STORE ─────────────────────────────────────────────────
  // Store flattened results for list cache

  useEffect(() => {
    if (!data?.pages?.length) return

    // Flatten all pages into IDs
    const allIds: string[] = []

    for (const page of data.pages) {
      if (page.ids) {
        allIds.push(...page.ids)
      }
    }

    // Get snapshot ID from first page
    const firstPage = data.pages[0]
    if (firstPage?.snapshotId) {
      snapshotIdRef.current = firstPage.snapshotId
    }

    const lastPage = data.pages[data.pages.length - 1]

    // Calculate next cursor for store
    let nextCursor: string | null = null
    if (lastPage?.hasMore && lastPage.snapshotId) {
      nextCursor = encodeCursor(lastPage.snapshotId, allIds.length)
    }

    setList(listKey, {
      ids: allIds,
      total: lastPage?.total ?? allIds.length,
      fetchedAt: Date.now(),
      nextCursor,
    })
  }, [data, listKey, setList])

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
  // Return IDs only - rows subscribe individually via useRecord

  // Prefer cached data if available
  const recordIds = cachedList?.ids ?? (data?.pages?.flatMap((p) => p.ids) || EMPTY_IDS)
  const total = cachedList?.total ?? data?.pages?.[data.pages.length - 1]?.total ?? 0

  return {
    recordIds,
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
