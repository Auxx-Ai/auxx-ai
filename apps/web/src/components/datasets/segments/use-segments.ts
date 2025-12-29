// apps/web/src/components/datasets/segments/use-segments.ts
import { useState, useMemo, useCallback, useEffect } from 'react'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import type { DocumentSegment } from '@auxx/database/types'
interface UseSegmentsOptions {
  initialSearchQuery?: string
  chunkSize?: number
  enableVirtualization?: boolean
}
interface UseSegmentsReturn {
  // Data
  segments: DocumentSegment[]
  filteredSegments: DocumentSegment[]
  totalCount: number
  loadedCount: number
  // Selection
  selectedSegments: Set<string>
  handleSelectionChange: (segmentId: string, selected: boolean) => void
  handleSelectAll: (selected: boolean) => void
  clearSelection: () => void
  // Search
  searchQuery: string
  handleSearch: (query: string) => void
  handleSearchClear: () => void
  // Loading states
  isLoading: boolean
  isFetchingNextPage: boolean
  hasMore: boolean
  isLoadingAll: boolean
  // Pagination
  loadMore: () => void
  loadAll: () => void
  refetch: () => void
  // Batch operations
  batchDelete: (segmentIds?: string[]) => Promise<void>
  batchToggleEnabled: (enabled: boolean, segmentIds?: string[]) => Promise<void>
  batchReindex: (segmentIds?: string[]) => Promise<void>
}
/**
 * Hook for managing document segments with progressive local search
 * Loads segments in chunks and filters locally for instant search
 */
export function useSegments(
  documentId: string,
  options: UseSegmentsOptions = {}
): UseSegmentsReturn {
  const {
    initialSearchQuery = '',
    chunkSize = 500, // Load 500 segments at a time
    enableVirtualization = true,
  } = options
  // State
  const [allSegments, setAllSegments] = useState<DocumentSegment[]>([])
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  // API utils
  const utils = api.useUtils()
  // Infinite query for progressive loading
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    api.segment.listByDocument.useInfiniteQuery(
      {
        documentId,
        limit: chunkSize, // Large chunks for efficient loading
        // No search param - we'll filter locally
      },
      {
        getNextPageParam: (lastPage) =>
          lastPage.hasMore ? { page: (lastPage.page || 1) + 1 } : undefined,
        staleTime: 10 * 60 * 1000, // 10 minutes - data is relatively stable
        gcTime: 15 * 60 * 1000, // 15 minutes cache
        refetchOnWindowFocus: false,
      }
    )
  // Update allSegments when new data arrives
  useEffect(() => {
    if (data?.pages) {
      const segments = data.pages.flatMap((page) => page.segments)
      setAllSegments(segments)
    }
  }, [data])
  // Total count from first page
  const totalCount = data?.pages[0]?.totalCount ?? 0
  const loadedCount = allSegments.length
  // Local filtering for instant search
  const filteredSegments = useMemo(() => {
    if (!searchQuery) return allSegments
    const query = searchQuery.toLowerCase()
    return allSegments.filter((segment) => {
      // Search in content
      if (segment.content.toLowerCase().includes(query)) return true
      // Search by position (exact or partial match)
      if (segment.position.toString().includes(query)) return true
      // Search by status
      if (segment.indexStatus?.toLowerCase().includes(query)) return true
      // Search in metadata if available
      if (segment.metadata && typeof segment.metadata === 'object') {
        const metadataStr = JSON.stringify(segment.metadata).toLowerCase()
        if (metadataStr.includes(query)) return true
      }
      return false
    })
  }, [allSegments, searchQuery])
  // Load all remaining segments in the background
  const loadAll = useCallback(async () => {
    if (!hasNextPage || isLoadingAll) return
    setIsLoadingAll(true)
    try {
      while (hasNextPage) {
        await fetchNextPage()
      }
    } catch (error) {
      console.error('Failed to load all segments:', error)
    } finally {
      setIsLoadingAll(false)
    }
  }, [hasNextPage, fetchNextPage, isLoadingAll])
  // Auto-load all segments when search is initiated
  useEffect(() => {
    if (searchQuery && hasNextPage && !isLoadingAll) {
      loadAll()
    }
  }, [searchQuery, hasNextPage, loadAll, isLoadingAll])
  // Search handlers - no debouncing needed for local search!
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
      // Clear selection when searching
      if (query && selectedSegments.size > 0) {
        setSelectedSegments(new Set())
      }
      // Start loading remaining segments if searching and not all loaded
      if (query && hasNextPage && !isLoadingAll) {
        loadAll()
      }
    },
    [selectedSegments.size, hasNextPage, isLoadingAll, loadAll]
  )
  const handleSearchClear = useCallback(() => {
    setSearchQuery('')
    setSelectedSegments(new Set())
  }, [])
  // Selection handlers
  const handleSelectionChange = useCallback((segmentId: string, selected: boolean) => {
    setSelectedSegments((prev) => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(segmentId)
      } else {
        newSet.delete(segmentId)
      }
      return newSet
    })
  }, [])
  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedSegments(new Set(filteredSegments.map((s) => s.id)))
      } else {
        setSelectedSegments(new Set())
      }
    },
    [filteredSegments]
  )
  const clearSelection = useCallback(() => {
    setSelectedSegments(new Set())
  }, [])
  // Load more handler
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  // Batch operations mutations
  const batchDeleteMutation = api.segment.batchUpdate.useMutation({
    onMutate: async ({ segmentIds }) => {
      // Cancel any outgoing refetches
      await utils.segment.listByDocument.cancel({ documentId })
      await utils.document.getById.cancel({ documentId })
      // Snapshot the previous values
      const previousSegments = utils.segment.listByDocument.getData({ documentId })
      const previousDocument = utils.document.getById.getData({ documentId })
      // Optimistically update the cache to remove these segments
      const idsToDelete = new Set(segmentIds)
      utils.segment.listByDocument.setInfiniteData({ documentId }, (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            segments: page.segments.filter((s) => !idsToDelete.has(s.id)),
            totalCount: Math.max(0, (page.totalCount || 0) - segmentIds.length),
          })),
        }
      })
      // Also update local state immediately
      setAllSegments((prev) => prev.filter((s) => !idsToDelete.has(s.id)))
      // Return a context with the snapshots
      return { previousSegments, previousDocument }
    },
    onSuccess: () => {
      utils.document.getById.invalidate({ documentId })
      utils.segment.listByDocument.invalidate({ documentId })
      clearSelection()
    },
    onError: (error, _, context) => {
      // Restore the previous data if available
      if (context?.previousSegments) {
        utils.segment.listByDocument.setInfiniteData({ documentId }, context.previousSegments)
        // Also restore local state from the cache
        const segments = context.previousSegments.pages.flatMap((page) => page.segments)
        setAllSegments(segments)
      }
      if (context?.previousDocument) {
        utils.document.getById.setData({ documentId }, context.previousDocument)
      }
      toastError({
        title: 'Failed to delete segments',
        description: error.message,
      })
    },
  })
  const batchToggleEnabledMutation = api.segment.batchUpdate.useMutation({
    onSuccess: () => {
      utils.document.getById.invalidate({ documentId })
      utils.segment.listByDocument.invalidate({ documentId })
      clearSelection()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update segments',
        description: error.message,
      })
    },
  })
  const batchReindexMutation = api.segment.batchUpdate.useMutation({
    onSuccess: () => {
      utils.document.getById.invalidate({ documentId })
      utils.segment.listByDocument.invalidate({ documentId })
      clearSelection()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to reindex segments',
        description: error.message,
      })
    },
  })
  // Maximum batch size allowed by the API
  const BATCH_SIZE = 100

  /**
   * Chunks an array into smaller arrays of specified size
   */
  const chunkArray = <T>(array: T[], size: number): T[][] => {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  // Batch operation handlers
  const handleBatchDelete = useCallback(
    async (segmentIds?: string[]) => {
      const ids = segmentIds || Array.from(selectedSegments)
      if (ids.length === 0) return

      const chunks = chunkArray(ids, BATCH_SIZE)
      for (const chunk of chunks) {
        await batchDeleteMutation.mutateAsync({
          segmentIds: chunk,
          operation: 'delete',
        })
      }
    },
    [selectedSegments, batchDeleteMutation]
  )
  const handleBatchToggleEnabled = useCallback(
    async (enabled: boolean, segmentIds?: string[]) => {
      const ids = segmentIds || Array.from(selectedSegments)
      if (ids.length === 0) return

      const chunks = chunkArray(ids, BATCH_SIZE)
      for (const chunk of chunks) {
        await batchToggleEnabledMutation.mutateAsync({
          segmentIds: chunk,
          operation: enabled ? 'enable' : 'disable',
        })
      }
    },
    [selectedSegments, batchToggleEnabledMutation]
  )
  const handleBatchReindex = useCallback(
    async (segmentIds?: string[]) => {
      const ids = segmentIds || Array.from(selectedSegments)
      if (ids.length === 0) return

      const chunks = chunkArray(ids, BATCH_SIZE)
      for (const chunk of chunks) {
        await batchReindexMutation.mutateAsync({
          segmentIds: chunk,
          operation: 'reindex',
        })
      }
    },
    [selectedSegments, batchReindexMutation]
  )
  return {
    // Data
    segments: allSegments,
    filteredSegments,
    totalCount,
    loadedCount,
    // Selection
    selectedSegments,
    handleSelectionChange,
    handleSelectAll,
    clearSelection,
    // Search - now instant without debouncing!
    searchQuery,
    handleSearch,
    handleSearchClear,
    // Loading states
    isLoading,
    isFetchingNextPage,
    hasMore: hasNextPage ?? false,
    isLoadingAll,
    // Pagination
    loadMore,
    loadAll,
    refetch,
    // Batch operations
    batchDelete: handleBatchDelete,
    batchToggleEnabled: handleBatchToggleEnabled,
    batchReindex: handleBatchReindex,
  }
}
