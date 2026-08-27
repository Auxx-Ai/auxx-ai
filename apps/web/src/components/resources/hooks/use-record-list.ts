// apps/web/src/components/resources/hooks/use-record-list.ts

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { type DroppedFilterNotice, toRecordId } from '@auxx/lib/resources/client'
import { useCallback, useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import {
  createListKey,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  isListStale,
  type RecordMeta,
  useRecordStore,
} from '../store/record-store'
import { useNormalizedDefinitionId } from '../utils/normalize-record-id'

/** Stable empty array for default return */
const EMPTY_IDS: string[] = []

/** Stable empty array so a clean list never hands consumers a fresh identity. */
const EMPTY_DROPPED: DroppedFilterNotice[] = []

interface UseRecordListOptions {
  /** EntityDefinition UUID. Alias forms (entityType/apiSlug) are normalized internally. */
  entityDefinitionId: string
  /** Filter conditions - pass undefined or stable reference, NOT [] */
  filters?: ConditionGroup[]
  /**
   * Free-text search — a separate axis from {@link filters} (plan decision 0.3).
   * Conditions narrow; this IS the search, and the server ranks by relevance
   * unless `sorting` is set.
   */
  search?: string
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
  /**
   * Filter conditions the server could not compile and therefore did NOT apply.
   * Empty in the normal case.
   *
   * **Non-empty means this list is WIDER than the filters say it is.** The query
   * lane fails open on purpose so a saved view naming a retired field still
   * renders; this is the channel that stops that being invisible. Render it
   * quietly — it is not an error state and there is nothing for the user to fix.
   */
  droppedConditions: DroppedFilterNotice[]
  /** Uncapped total behind {@link droppedConditions} (the array is server-capped). */
  droppedConditionCount: number
  /** Resolved records from record store (may be partial while loading) */
  records: T[]
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
  /**
   * Add a freshly-created record to this list's caches — BOTH the record store
   * and the tRPC query pages. The acting tab is excluded from its own
   * `record:created` realtime frame, so this is its only path; writing just one
   * cache makes the row revert on the next remount.
   */
  appendCreated: (instanceId: string) => void
  /**
   * Optimistically drop a record from this list's caches. Does the full store
   * eviction (`removeRecord`) as well — do not pair it with a separate
   * `removeRecord` call.
   */
  removeFromList: (instanceId: string) => void
  /** Data came from cache */
  isCached: boolean
}

/**
 * Hook to fetch and cache a filtered/sorted list of record IDs.
 * Returns record IDs - each row should use useRecord(id) for its data.
 *
 * Uses useInfiniteQuery for offset pagination — each page is its own
 * `LIMIT n + 1 OFFSET m` query. The cursor is a typed object { offset }.
 *
 * This pattern enables row-level reactivity:
 * - Only the row whose record changed will re-render
 * - Other rows maintain stable references via immer
 *
 * IMPORTANT: Do NOT pass [] or {} as defaults - use undefined instead.
 */
export function useRecordList<T extends RecordMeta = RecordMeta>({
  entityDefinitionId: rawEntityDefinitionId,
  filters,
  search,
  sorting,
  limit = 50,
  enabled = true,
}: UseRecordListOptions): UseRecordListResult<T> {
  // Canonicalize the definition prefix once — listKey, requestRecord, and all
  // records[...] reads below key by the EntityDefinition UUID.
  const entityDefinitionId = useNormalizedDefinitionId(rawEntityDefinitionId)

  // Use stable empty defaults to prevent infinite loops
  const stableFilters = filters ?? EMPTY_FILTERS
  const stableSorting = sorting ?? EMPTY_SORTING

  // Create stable list key for store caching
  const listKey = useMemo(
    () => createListKey(entityDefinitionId, stableFilters, stableSorting, search),
    [entityDefinitionId, stableFilters, stableSorting, search]
  )

  // ─── SELECTORS ─────────────────────────────────────────────────────
  // Check if we have a valid cache before fetching

  const listCache = useRecordStore((s) => s.lists[listKey])
  const cachedList = listCache && !isListStale(listCache) ? listCache : undefined

  // Select action functions (stable references)
  const setList = useRecordStore((s) => s.setList)

  // ─── INFINITE QUERY ────────────────────────────────────────────────
  // Offset pagination with typed cursor object { offset }

  const shouldFetch = enabled && !cachedList

  // Stable query input to prevent infinite loops
  const queryInput = useMemo(
    () => ({
      entityDefinitionId,
      filters: stableFilters.length > 0 ? stableFilters : undefined,
      search: search || undefined,
      sorting: stableSorting.length > 0 ? stableSorting : undefined,
      limit,
    }),
    [entityDefinitionId, stableFilters, search, stableSorting, limit]
  )

  const {
    data,
    dataUpdatedAt,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage: fetchNextPageRaw,
    refetch,
  } = api.record.listFiltered.useInfiniteQuery(queryInput, {
    enabled: shouldFetch,
    staleTime: 30_000,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined
      // Calculate total IDs fetched so far across all pages
      const totalFetched = allPages.reduce((sum, page) => sum + page.ids.length, 0)
      return { offset: totalFetched }
    },
  })

  // Get request action for batch fetching
  const requestRecord = useRecordStore((s) => s.requestRecord)

  const utils = api.useUtils()

  // ─── SYNC QUERY PAGES TO STORE ───────────────────────────────────
  //
  // 🛑 `data` is frequently React Query's CACHE, not a fresh response — this
  // query is DISABLED whenever the store cache is warm (`shouldFetch` above), so
  // an already-mounted observer keeps handing back the pages it fetched minutes
  // ago. Two rules follow, and the list stops self-healing without either:
  //
  //   1. stamp `fetchedAt` with the query's real `dataUpdatedAt`, never
  //      `Date.now()`. Stamping "now" re-arms the 5-minute TTL on a stale
  //      snapshot, so `shouldFetch` never flips back to true and the only repair
  //      left is a full page reload.
  //   2. never overwrite a store list that already reflects this same server
  //      snapshot. Equal timestamps are the NORMAL case (the store list was
  //      written FROM these pages and has since taken optimistic appends /
  //      removals), which is why the guard is `>=` and not `>`.
  useEffect(() => {
    if (!data?.pages?.length) return

    const existing = useRecordStore.getState().lists[listKey]
    if (existing && existing.fetchedAt >= dataUpdatedAt) return

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

    const lastPage = data.pages[data.pages.length - 1]

    // Store uses nextCursor to track if more pages exist (value doesn't matter, just presence)
    const nextCursor = lastPage?.hasMore ? 'more' : null

    setList(listKey, {
      ids: allIds,
      // `total` rides on the first page only — later pages omit the COUNT.
      total: data.pages[0]?.total ?? allIds.length,
      fetchedAt: dataUpdatedAt,
      nextCursor,
      // Same story as `total`: every page carries the identical drop diagnostics
      // (they come from the same filter build), so the first page is the source.
      droppedConditions: data.pages[0]?.droppedConditions,
      droppedConditionCount: data.pages[0]?.droppedConditionCount,
    })
  }, [data, dataUpdatedAt, listKey, setList])

  // ─── FETCH NEXT PAGE ────────────────────────────────────────────────

  const fetchNextPage = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) {
      fetchNextPageRaw()
    }
  }, [fetchNextPageRaw, isFetchingNextPage, hasNextPage])

  // ─── REFRESH ───────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    useRecordStore.getState().invalidateList(listKey)
    refetch()
  }, [listKey, refetch])

  // ─── OPTIMISTIC MEMBERSHIP (BOTH CACHES) ───────────────────────────
  //
  // 🛑 `record.create` / `record.delete` deliberately exclude the originating
  // socket from their realtime events (`unified-handler-mutations.ts`), so the
  // acting tab never receives the `record:created` / `record:deleted` frame that
  // makes every OTHER tab invalidate. Seeding is the actor's only instant path —
  // and it has to reach BOTH caches, because either one can be the display
  // source (see `recordIds` below). Writing only the store means the row is
  // visible until the next remount and then silently reverts to the query's
  // pre-write pages.
  //
  // This hook is the only place that holds both halves — the `listKey` (store)
  // and the `queryInput` (React Query) — which is why the mutation lives here
  // rather than in `useSeedCreatedRecord`, whose `listKey` is an opaque hash.

  /** Add a freshly-created record to both caches for this list. */
  const appendCreated = useCallback(
    (instanceId: string) => {
      useRecordStore.getState().appendCreatedRecord(listKey, instanceId)
      utils.record.listFiltered.setInfiniteData(queryInput, (prev) => {
        // 🛑 Never fabricate a page. `undefined` means "never fetched"; inventing
        // one here reads as loaded data and would suppress the first real fetch
        // forever — strictly worse than the bug this exists to fix.
        if (!prev?.pages.length) return prev
        if (prev.pages.some((page) => page.ids.includes(instanceId))) return prev
        const lastIndex = prev.pages.length - 1
        return {
          ...prev,
          pages: prev.pages.map((page, i) => ({
            ...page,
            ids: i === lastIndex ? [...page.ids, instanceId] : page.ids,
            // `total` rides on the first page only — bumping it on every page
            // would drift the count by the number of pages loaded. An absent
            // total stays absent rather than being invented as 1.
            total: i === 0 && page.total !== undefined ? page.total + 1 : page.total,
          })),
        }
      })
    },
    [listKey, queryInput, utils]
  )

  /**
   * Drop a record from both caches (optimistic delete).
   *
   * The store half is `removeRecord`, which does the full job — evicts the
   * `RecordMeta`, marks the id not-found so `requestRecord` will not resurrect
   * it, and splices it out of every cached list for this definition. Call sites
   * should NOT also call `removeRecord` themselves.
   */
  const removeFromList = useCallback(
    (instanceId: string) => {
      useRecordStore.getState().removeRecord(entityDefinitionId, instanceId)
      utils.record.listFiltered.setInfiniteData(queryInput, (prev) => {
        if (!prev?.pages.length) return prev
        if (!prev.pages.some((page) => page.ids.includes(instanceId))) return prev
        return {
          ...prev,
          pages: prev.pages.map((page, i) => ({
            ...page,
            ids: page.ids.filter((id) => id !== instanceId),
            total: i === 0 && page.total !== undefined ? Math.max(0, page.total - 1) : page.total,
          })),
        }
      })
    },
    [entityDefinitionId, listKey, queryInput, utils]
  )

  // ─── RETURN ────────────────────────────────────────────────────────
  // Return IDs and resolved items from record store

  // Prefer cached data if available. Memoized so the array keeps a stable
  // identity across unrelated re-renders (e.g. a selection toggle). `records`
  // below depends on it, and an unstable `records` becomes an unstable `data`
  // prop to TanStack — whose core row model is memoized on `data` identity, so a
  // new array rebuilds every row + cell object and re-renders every visible cell
  // (the whole-table flash on select-all). The inline `flatMap` returned a fresh
  // array each render whenever the list cache was absent/stale.
  const recordIds = useMemo(
    () => cachedList?.ids ?? (data?.pages?.flatMap((p: { ids: string[] }) => p.ids) || EMPTY_IDS),
    [cachedList, data]
  )
  const total = cachedList?.total ?? data?.pages?.[0]?.total ?? 0

  // Read through the store cache exactly like `ids`/`total` do — the cache is
  // served INSTEAD of the query for 5 minutes, so sourcing this from `data` alone
  // would drop the warning on remount while the list stayed just as wide.
  const droppedConditions =
    (cachedList ? cachedList.droppedConditions : data?.pages?.[0]?.droppedConditions) ??
    EMPTY_DROPPED
  const droppedConditionCount =
    (cachedList ? cachedList.droppedConditionCount : data?.pages?.[0]?.droppedConditionCount) ??
    droppedConditions.length

  // ─── QUEUE RECORD FETCHES ──────────────────────────────────────────
  //
  // Keyed on the DISPLAYED ids, not on `data`. The store cache is served instead
  // of the query for 5 minutes, so queueing from the query response alone means a
  // list served from cache queues nothing at all — a row whose `RecordMeta` was
  // evicted (or was never fetched, e.g. an optimistically appended id) renders as
  // a hole with no repair path short of a reload. `requestRecord` dedupes against
  // records / pending / loading / notFound, so this is cheap and idempotent.
  useEffect(() => {
    if (!recordIds.length) return
    const cache = useRecordStore.getState().records[entityDefinitionId]
    for (const id of recordIds) {
      if (!cache?.has(id)) requestRecord(toRecordId(entityDefinitionId, id))
    }
  }, [recordIds, entityDefinitionId, requestRecord])

  // ─── RESOLVE RECORDS FROM RECORD STORE ─────────────────────────────────
  // Subscribe to record cache for this entity definition
  const recordCache = useRecordStore((s) => s.records[entityDefinitionId])
  const loadingIds = useRecordStore((s) => s.loadingIds)
  const pendingIds = useRecordStore((s) => s.pendingFetchIds)

  // Resolve records from cache - filter out undefined (not yet loaded)
  const records = useMemo(() => {
    if (!recordCache) return [] as T[]
    return recordIds
      .map((id: string) => recordCache.get(id) as T | undefined)
      .filter((record: T | undefined): record is T => record !== undefined)
  }, [recordCache, recordIds])

  // Check if any records are still loading
  const isLoadingRecords = useMemo(() => {
    if (!recordIds.length) return false
    // Records are loading if we have fewer records than IDs, and some are pending/loading
    if (records.length < recordIds.length) {
      const hasLoading = recordIds.some((id: string) => {
        const recordId = toRecordId(entityDefinitionId, id)
        return loadingIds.has(recordId) || pendingIds.has(recordId)
      })
      return hasLoading
    }
    return false
  }, [recordIds, records.length, loadingIds, pendingIds, entityDefinitionId])

  return {
    recordIds,
    droppedConditions,
    droppedConditionCount,
    records,
    isLoadingRecords,
    listKey,
    total,
    isLoading: shouldFetch && isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? cachedList?.nextCursor !== null,
    fetchNextPage,
    refresh,
    appendCreated,
    removeFromList,
    isCached: !!cachedList,
  }
}
