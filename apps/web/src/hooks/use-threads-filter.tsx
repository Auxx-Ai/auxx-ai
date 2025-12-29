// ~/hooks/use-threads.ts
import { keepPreviousData } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { useMemo } from 'react'
import type { ThreadsFilterInput, ThreadListItem, ContextType } from '~/components/mail/types'
import { api } from '~/trpc/react'

// Define the input props for the hook, mirroring the backend input structure
// type UseThreadsInput = NonNullable<RouterInputs['thread']['list']['filter']>

// Define the output type for a single thread item (adjust based on backend include)
// This uses the inferred output type from tRPC
// type ThreadListItem = RouterOutputs['thread']['list']['items'][number]

// Type helper for the filter input of the hook
// export type ThreadsFilter = UseThreadsInput
// Type helper for the output thread item
// export type ThreadWithRelations = ThreadListItem

// --- The useThreads Hook Implementation ---
export default function useThreads(
  filter: ThreadsFilterInput, // Use the defined filter type
  options: { limit?: number; enabled?: boolean } = {} // Optional: Allow overriding limit
) {
  const queryLimit = options.limit ?? 30 // Default limit for the query
  const enabled = options.enabled ?? true // Default to enabled
  const queryKey = getQueryKey(api.thread.list, {}, 'query')

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    refetch,
    error,
    status, // Add status for more granular loading states ('loading', 'error', 'success')
  } = api.thread.list.useInfiniteQuery(
    {
      // Pass the filter properties directly to the tRPC input
      contextType: filter.contextType as ContextType,
      contextId: filter.contextId,
      statusSlug: filter.statusSlug,
      searchQuery: filter.searchQuery,
      sortBy: filter.sortBy,
      sortDirection: filter.sortDirection,
      limit: queryLimit, // Use the determined limit
      // cursor is handled internally by useInfiniteQuery via getNextPageParam
    },
    {
      placeholderData: keepPreviousData,

      getNextPageParam: (lastPage) => lastPage.nextCursor, // Extract cursor from the last page data
      staleTime: 0,
      // Optional configurations:
      staleTime: 1000 * 60 * 1, // Cache data for 1 minute
      enabled,
      // refetchOnWindowFocus: false,
      // enabled: !!filter.contextType, // Example: only run query if contextType is set
    }
  )

  // Flatten the pages array into a single array of threads
  const threads = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? []
  }, [data])

  return {
    threads: threads as ThreadListItem[], // Cast for external use
    isFetching,
    isLoading, // More reliable initial loading state
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage: !!hasNextPage, // Ensure boolean
    refetch,
    error,
    queryKey,
    status, // Expose the query status ('loading', 'error', 'success')
  }
}
