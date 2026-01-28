// apps/web/src/components/threads/hooks/use-thread-list.ts

import { useMemo, useEffect, useCallback } from 'react'
import { useShallow } from 'zustand/shallow'
import { useThreadStore, type ThreadMeta, type ThreadSort } from '../store'
import {
  createContextKey,
  createThreadSelector,
  type ThreadFilter,
} from '../store/thread-selectors'
import { mapStatusSlugToClientFilter, type ThreadClientFilter } from '@auxx/lib/mail-query/client'
import type { ApiSearchFilter } from '@auxx/lib/mail-query'
import { api } from '~/trpc/react'

interface ThreadListFilter {
  contextType: string
  contextId?: string
  statusSlug?: string
  /** Legacy search query string (deprecated, use filter instead) */
  searchQuery?: string
  /** Structured API filter (preferred over searchQuery) */
  filter?: ApiSearchFilter
  sortBy?: 'newest' | 'oldest' | 'sender' | 'subject'
  sortDirection?: 'asc' | 'desc'
}

interface UseThreadListResult {
  /** Thread IDs in the list (for backward compatibility) */
  threadIds: string[]
  /** Filtered and sorted threads */
  threads: ThreadMeta[]
  /** Total count (may be > threads.length if paginated) */
  total: number
  /** Initial load in progress */
  isLoading: boolean
  /** Fetching next page */
  isFetchingNextPage: boolean
  /** More pages available */
  hasNextPage: boolean
  /** Fetch next page of results */
  fetchNextPage: () => void
  /** Refresh the list (invalidate and refetch) */
  refresh: () => void
}

/**
 * Map sortBy option to ThreadSort.
 */
function mapSortOption(sortBy?: string, sortDirection?: string): ThreadSort {
  const direction = (sortDirection === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'

  switch (sortBy) {
    case 'oldest':
      return { field: 'lastMessageAt', direction: 'asc' }
    case 'newest':
      return { field: 'lastMessageAt', direction: 'desc' }
    case 'subject':
      return { field: 'subject', direction }
    default:
      return { field: 'lastMessageAt', direction: 'desc' }
  }
}

/**
 * Hook to get thread list by filter.
 *
 * Uses hybrid approach:
 * 1. Server fetches thread IDs for the context (pagination, search)
 * 2. Client derives filtered view from loaded threads
 * 3. Optimistic updates just modify thread properties - views update automatically
 *
 * @example
 * const { threads, threadIds, isLoading, fetchNextPage } = useThreadList({
 *   contextType: 'personal_inbox',
 *   statusSlug: 'open'
 * })
 *
 * return threads.map(thread => <ThreadItem key={thread.id} thread={thread} />)
 */
export function useThreadList(filter: ThreadListFilter): UseThreadListResult {
  const contextKey = useMemo(() => createContextKey(filter), [filter])

  // Store selectors
  const contextPagination = useThreadStore((s) => s.loadedContexts.get(contextKey))
  const setContextLoaded = useThreadStore((s) => s.setContextLoaded)
  const invalidateContext = useThreadStore((s) => s.invalidateContext)
  const requestThread = useThreadStore((s) => s.requestThread)

  // Build client-side filter for derived view using shared utility
  // This mirrors server-side behavior for consistent optimistic updates
  const clientFilter = useMemo((): ThreadClientFilter => {
    // Start with status slug filter (may include status and/or hasAssignee)
    const slugFilter = mapStatusSlugToClientFilter(filter.statusSlug)

    const f: ThreadClientFilter = { ...slugFilter }

    // Inbox filter for specific_inbox context
    if (filter.contextType === 'specific_inbox' && filter.contextId) {
      f.inboxId = filter.contextId
    }

    return f
  }, [filter.contextType, filter.contextId, filter.statusSlug])

  const sortOption = useMemo(
    () => mapSortOption(filter.sortBy, filter.sortDirection),
    [filter.sortBy, filter.sortDirection]
  )

  // Create selector for this filter - memoized to prevent recreation
  const threadSelector = useMemo(
    () => createThreadSelector(clientFilter, sortOption),
    [clientFilter, sortOption]
  )

  // Subscribe to derived thread list
  // useShallow prevents re-renders when array contents are identical
  // (immer creates new Map references on any thread update)
  const threads = useThreadStore(useShallow(threadSelector))

  // Build API filter - prefer structured filter, fall back to legacy searchQuery
  const apiFilter = useMemo((): ApiSearchFilter | undefined => {
    // If structured filter is provided, use it
    if (filter.filter) {
      return filter.filter
    }
    // Fall back to legacy search query string
    if (filter.searchQuery) {
      return { search: filter.searchQuery }
    }
    return undefined
  }, [filter.filter, filter.searchQuery])

  // Fetch IDs via tRPC infinite query
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage: queryHasNextPage,
    fetchNextPage: fetchMore,
    refetch,
  } = api.thread.listIds.useInfiniteQuery(
    {
      contextType: filter.contextType as any,
      contextId: filter.contextId,
      statusSlug: filter.statusSlug,
      sortBy: filter.sortBy,
      sortDirection: filter.sortDirection,
      filter: apiFilter,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 30_000,
    }
  )

  // Sync fetched data to store and queue metadata fetches
  useEffect(() => {
    if (!data?.pages) return

    const allIds = data.pages.flatMap((p) => p.ids)
    const total = data.pages[0]?.total ?? 0
    const lastPage = data.pages[data.pages.length - 1]
    const hasMore = !!lastPage?.nextCursor

    // Mark context as loaded with pagination info
    setContextLoaded(contextKey, lastPage?.nextCursor ?? null, hasMore, total)

    // Queue metadata fetch for uncached threads
    for (const id of allIds) {
      requestThread(id)
    }
  }, [data, contextKey, setContextLoaded, requestThread])

  // Refresh handler - invalidate context and refetch
  const refresh = useCallback(() => {
    invalidateContext(contextKey)
    refetch()
  }, [contextKey, invalidateContext, refetch])

  // Fetch next page
  const fetchNextPage = useCallback(() => {
    if (!isFetchingNextPage && (queryHasNextPage || contextPagination?.hasMore)) {
      fetchMore()
    }
  }, [fetchMore, isFetchingNextPage, queryHasNextPage, contextPagination])

  // Derive thread IDs from threads for backward compatibility
  const threadIds = useMemo(() => threads.map((t) => t.id), [threads])

  return {
    threadIds,
    threads,
    total: contextPagination?.total ?? data?.pages?.[0]?.total ?? threads.length,
    isLoading,
    isFetchingNextPage,
    hasNextPage: queryHasNextPage ?? contextPagination?.hasMore ?? false,
    fetchNextPage,
    refresh,
  }
}
