// apps/web/src/components/threads/hooks/use-thread-list.ts

import { useMemo, useEffect, useCallback } from 'react'
import { useThreadListStore, createListKey, useThreadStore } from '../store'
import { api } from '~/trpc/react'

interface ThreadListFilter {
  contextType: string
  contextId?: string
  statusSlug?: string
  searchQuery?: string
  sortBy?: 'newest' | 'oldest' | 'sender' | 'subject'
  sortDirection?: 'asc' | 'desc'
}

interface UseThreadListResult {
  /** Thread IDs in the list */
  threadIds: string[]
  /** Total count (may be > threadIds.length if paginated) */
  total: number
  /** Initial load in progress */
  isLoading: boolean
  /** Fetching next page */
  isFetchingNextPage: boolean
  /** More pages available */
  hasNextPage: boolean
  /** Fetch next page of results */
  fetchNextPage: () => void
  /** Refresh the list */
  refresh: () => void
}

/**
 * Hook to get thread list by filter.
 * Returns IDs only - use useThread() to get thread data.
 *
 * @example
 * const { threadIds, isLoading, fetchNextPage } = useThreadList({
 *   contextType: 'personal_inbox',
 *   statusSlug: 'open'
 * })
 *
 * return threadIds.map(id => <ThreadItem key={id} threadId={id} />)
 */
export function useThreadList(filter: ThreadListFilter): UseThreadListResult {
  const listKey = useMemo(() => createListKey(filter), [filter])
  const cachedList = useThreadListStore((s) => s.lists[listKey])
  const setActiveListKey = useThreadListStore((s) => s.setActiveListKey)
  const setList = useThreadListStore((s) => s.setList)
  const appendToList = useThreadListStore((s) => s.appendToList)
  const requestThread = useThreadStore((s) => s.requestThread)

  // Set active list key for optimistic updates
  useEffect(() => {
    setActiveListKey(listKey)
    return () => setActiveListKey(null)
  }, [listKey, setActiveListKey])

  // Fetch IDs via tRPC infinite query
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage: fetchMore,
    refetch,
  } = api.thread.listIds.useInfiniteQuery(
    {
      contextType: filter.contextType as any,
      contextId: filter.contextId,
      statusSlug: filter.statusSlug,
      sortBy: filter.sortBy,
      sortDirection: filter.sortDirection,
      filter: filter.searchQuery ? { search: filter.searchQuery } : undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 30_000,
    }
  )

  // Sync to store and queue metadata fetches
  useEffect(() => {
    if (!data?.pages) return

    const allIds = data.pages.flatMap((p) => p.ids)
    const total = data.pages[0]?.total ?? 0
    const nextCursor = data.pages[data.pages.length - 1]?.nextCursor ?? null

    setList(listKey, {
      ids: allIds,
      total,
      nextCursor,
      fetchedAt: Date.now(),
    })

    // Queue metadata fetch for uncached threads
    for (const id of allIds) {
      requestThread(id)
    }
  }, [data, listKey, setList, requestThread])

  // Handle next page fetch
  const fetchNextPage = useCallback(() => {
    fetchMore()
  }, [fetchMore])

  return {
    threadIds: cachedList?.ids ?? [],
    total: cachedList?.total ?? 0,
    isLoading,
    isFetchingNextPage,
    hasNextPage: !!hasNextPage || !!cachedList?.nextCursor,
    fetchNextPage,
    refresh: refetch,
  }
}
