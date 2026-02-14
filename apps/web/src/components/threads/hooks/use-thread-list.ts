// apps/web/src/components/threads/hooks/use-thread-list.ts

import type { ConditionGroup } from '@auxx/lib/conditions'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import { type ThreadMeta, type ThreadSort, useThreadStore } from '../store'
import {
  createContextKey,
  createThreadSelector,
  type ThreadFilter,
} from '../store/thread-selectors'

/** Sort descriptor for thread lists */
interface ThreadSortDescriptor {
  field: 'lastMessageAt' | 'subject' | 'sender'
  direction: 'asc' | 'desc'
}

/** Input for useThreadList hook - unified condition-based filtering */
interface UseThreadListInput {
  /** Condition-based filter (ConditionGroup[]) */
  filter: ConditionGroup[]
  /** Sort options */
  sort?: ThreadSortDescriptor
}

interface UseThreadListResult {
  /** Record IDs in the list (format: "thread:id" or "draft:id") */
  recordIds: RecordId[]
  /**
   * Thread IDs in the list (for backward compatibility).
   * @deprecated Use `recordIds` instead to support standalone drafts.
   */
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
 * Hook to get thread list by filter.
 *
 * Uses unified condition-based filtering:
 * 1. Filter is a ConditionGroup[] combining context + search conditions
 * 2. Server fetches thread IDs using condition-query-builder
 * 3. Client fetches thread metadata and stores in thread store
 *
 * @example
 * const { threads, threadIds, isLoading, fetchNextPage } = useThreadList({
 *   filter: buildConditionGroups({ contextType: 'personal_inbox', statusSlug: 'open' }),
 *   sort: { field: 'lastMessageAt', direction: 'desc' }
 * })
 */
export function useThreadList({ filter, sort }: UseThreadListInput): UseThreadListResult {
  // Create a stable context key from the filter for caching
  const contextKey = useMemo(() => JSON.stringify({ filter, sort }), [filter, sort])

  // Store selectors
  const contextPagination = useThreadStore((s) => s.loadedContexts.get(contextKey))
  const setContextLoaded = useThreadStore((s) => s.setContextLoaded)
  const invalidateContext = useThreadStore((s) => s.invalidateContext)
  const requestThread = useThreadStore((s) => s.requestThread)
  const requestDraft = useThreadStore((s) => s.requestDraft)
  const getThread = useThreadStore((s) => s.threads)

  // Fetch IDs via tRPC infinite query with unified condition-based filter
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage: queryHasNextPage,
    fetchNextPage: fetchMore,
    refetch,
  } = api.thread.listIds.useInfiniteQuery(
    { filter, sort },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 30_000,
    }
  )

  // Get all record IDs from paginated data (RecordId format: "thread:id" or "draft:id")
  const recordIds = useMemo(() => {
    if (!data?.pages) return []
    return data.pages.flatMap((p) => p.ids) as RecordId[]
  }, [data?.pages])

  // Extract thread IDs for backward compatibility (threads only)
  const threadIds = useMemo(() => {
    return recordIds
      .map((recordId) => {
        const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
        return entityDefinitionId === 'thread' ? entityInstanceId : null
      })
      .filter((id): id is string => id !== null)
  }, [recordIds])

  // Sync fetched data to store and queue metadata fetches
  useEffect(() => {
    if (!data?.pages) return

    const total = data.pages[0]?.total ?? 0
    const lastPage = data.pages[data.pages.length - 1]
    const hasMore = !!lastPage?.nextCursor

    // Mark context as loaded with pagination info
    setContextLoaded(contextKey, lastPage?.nextCursor ?? null, hasMore, total)

    // Queue metadata fetch for each entity based on type
    for (const recordId of recordIds) {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      if (entityDefinitionId === 'thread') {
        requestThread(entityInstanceId)
      } else if (entityDefinitionId === 'draft') {
        requestDraft(entityInstanceId)
      }
    }
  }, [data, contextKey, setContextLoaded, requestThread, requestDraft, recordIds])

  // Get thread metadata from store for the thread IDs we have
  // Note: Client-side filtering is now done by each MailThreadItem for efficiency
  const threads = useMemo(() => {
    const threadMap = getThread
    return threadIds.map((id) => threadMap.get(id)).filter((t): t is ThreadMeta => t !== undefined)
  }, [threadIds, getThread])

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

  return {
    recordIds,
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
