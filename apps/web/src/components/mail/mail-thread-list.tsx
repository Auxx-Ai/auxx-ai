// apps/web/src/components/mail/mail-thread-list.tsx
'use client'

import React, { useEffect, useRef } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useInView } from 'react-intersection-observer'

import { MailThreadItem } from './mail-thread-item'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ChevronDown, Loader2, Clock, User, FileText, ArrowUpDown } from 'lucide-react'
import type { ThreadsFilterInput } from './types'
import { Checkbox } from '@auxx/ui/components/checkbox'

// NEW: Import selection hooks from threads module
import {
  useThreadSelection,
  useThreadKeyboardNav,
  useSelectionReset,
} from '~/components/threads/hooks'
import {
  useViewMode,
  useThreadSelectionStore,
  useSelectedThreadIds,
} from '~/components/threads/store'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { useMailFilter, type SortOption } from './mail-filter-context'
import type { ViewMode } from '~/components/threads/store'
import { cn } from '@auxx/ui/lib/utils'

import { useThreadList } from '~/components/threads/hooks'

interface ThreadListProps {
  /** Filter configuration for fetching threads */
  filter: ThreadsFilterInput
  /** Base URL path for constructing thread links */
  basePath: string
  /** ID of the currently selected thread from URL search param */
  selectedThreadId?: string | null
  /** Callback when loading state changes */
  onLoadingChange?: (isLoading: boolean) => void
}

/**
 * Displays a list of thread items with infinite scroll pagination.
 * Uses the new ID-based architecture for improved performance.
 */
export function ThreadList({
  filter,
  basePath,
  selectedThreadId,
  onLoadingChange,
}: ThreadListProps) {
  // Use ID-based hook with structured filters
  const {
    threadIds,
    total,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refresh,
  } = useThreadList({
    contextType: filter.contextType,
    contextId: filter.contextId,
    statusSlug: filter.statusSlug,
    filter: filter.filter,
    searchQuery: filter.searchQuery,
    sortBy: filter.sortBy,
    sortDirection: filter.sortDirection,
  })

  // Selection hooks - use new thread selection system
  const { handleThreadClick } = useThreadSelection({ threadIds })

  // Keyboard navigation - handles arrow keys, Home/End, Cmd+A, Escape, etc.
  useThreadKeyboardNav({
    threadIds,
    enabled: true,
    onNavigateToEnd: () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
  })

  // Reset selection when filter changes
  useSelectionReset({
    contextType: filter.contextType,
    contextId: filter.contextId,
    statusSlug: filter.statusSlug,
  })

  // Auto-animation for list changes
  const [parent] = useAutoAnimate<HTMLDivElement>()

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isLoading || isFetchingNextPage)
    }
  }, [isLoading, isFetchingNextPage, onLoadingChange])

  // Infinite scroll trigger
  const container = useRef(null)
  const { ref, inView } = useInView({ threshold: 0 })

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, fetchNextPage, hasNextPage, isFetchingNextPage])

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[...Array(10)].map((_, i) => (
          <ThreadItemSkeleton key={`skel-${i}`} />
        ))}
      </div>
    )
  }

  const isEmpty = threadIds.length === 0 && !isFetchingNextPage

  return (
    <div className={cn('relative flex h-full w-full flex-col', isEmpty && 'flex-1')}>
      <div className={cn('overflow-y-auto', isEmpty && 'flex-1 flex flex-col')} ref={container}>
        <ThreadListMenu threadIds={threadIds} />

        <div className={cn('relative flex flex-col gap-2 p-4 pt-0', isEmpty && 'flex-1')} ref={parent}>
          {isEmpty && (
            <div className="p-8 text-center text-muted-foreground h-full flex items-center justify-center border rounded-2xl ring-inset ring-1 ring-muted/10">
              No threads found in this view.
            </div>
          )}

          {/* Render thread items - each fetches its own data */}
          {threadIds.map((threadId) => (
            <MailThreadItem
              key={threadId}
              threadId={threadId}
              basePath={basePath}
              isSelected={threadId === selectedThreadId}
              handleThreadClick={handleThreadClick}
            />
          ))}

          {isFetchingNextPage && (
            <div className="flex h-8 w-full items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
        </div>

        <div ref={ref} className="h-1" />
        {!hasNextPage && threadIds.length > 0 && !isFetchingNextPage && (
          <div className="pb-8 pt-4 text-center text-sm text-muted-foreground">End of list.</div>
        )}
      </div>
    </div>
  )
}

/** Skeleton for loading thread items */
function ThreadItemSkeleton() {
  return (
    <div className="flex items-start space-x-3 rounded-lg border p-3">
      <div className="grow space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  )
}

interface ThreadListMenuProps {
  /** Thread IDs needed for select all functionality */
  threadIds: string[]
}

/** Menu bar with view mode toggle and sort options */
function ThreadListMenu({ threadIds }: ThreadListMenuProps) {
  const { sortBy, setSortBy, setSortDirection } = useMailFilter()

  // Selection state from store
  const viewMode = useViewMode()
  const setViewMode = useThreadSelectionStore((s) => s.setViewMode)
  const selectedThreadIds = useSelectedThreadIds()
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection)
  const selectAll = useThreadSelectionStore((s) => s.selectAll)

  const selectedCount = selectedThreadIds.length
  const totalThreads = threadIds.length
  const allSelected = totalThreads > 0 && selectedCount === totalThreads
  const someSelected = selectedCount > 0 && selectedCount < totalThreads

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelection()
    } else {
      selectAll(threadIds)
    }
  }

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
  }

  const handleSortChange = (sort: SortOption) => {
    setSortBy?.(sort)
    if (sort === 'newest') {
      setSortDirection?.('desc')
    } else if (sort === 'oldest') {
      setSortDirection?.('desc')
    } else {
      setSortDirection?.('asc')
    }
  }

  const getSortLabel = () => {
    switch (sortBy) {
      case 'newest':
        return 'Newest First'
      case 'oldest':
        return 'Oldest First'
      case 'sender':
        return 'By Sender'
      case 'subject':
        return 'By Subject'
      default:
        return 'Sort'
    }
  }

  return (
    <div className="sticky top-0 z-10 h-10 bg-primary-100 flex flex-row items-center justify-between px-4">
      <div className="flex items-center justify-center rounded-full font-medium transition-colors text-xs py-0 w-[97px]">
        {viewMode === 'edit' && (
          <div
            className="ps-3 pe-2 border border-r-0 h-6 rounded-full rounded-r-none flex items-center justify-center cursor-pointer hover:bg-foreground/10"
            onClick={handleSelectAll}>
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              className="pointer-events-none"
            />
          </div>
        )}

        <Button
          variant="ghost"
          size="xs"
          onClick={() => handleViewModeChange(viewMode === 'edit' ? 'view' : 'edit')}
          className={cn(
            'border h-6 flex text-muted-foreground px-2 hover:bg-foreground/10 flex-1',
            viewMode === 'edit' ? 'rounded-full rounded-l-none' : 'rounded-full'
          )}>
          {viewMode === 'edit' ? 'Edit' : 'View'}
          <ChevronDown className="size-3 ml-auto" />
        </Button>
      </div>

      <div className="flex flex-row items-center gap-2">
        {viewMode === 'edit' && selectedCount > 0 && (
          <div className="text-xs text-muted-foreground mr-2">{selectedCount} selected</div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="rounded-full hover:bg-foreground/10 w-[130px] justify-start">
              <ArrowUpDown className="size-3 mr-1" />
              {getSortLabel()}
              <ChevronDown className="size-3 ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              onClick={() => handleSortChange('newest')}
              className={cn(sortBy === 'newest' && 'font-bold')}>
              <Clock />
              Newest First
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleSortChange('oldest')}
              className={cn(sortBy === 'oldest' && 'font-bold')}>
              <Clock />
              Oldest First
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleSortChange('sender')}
              className={cn(sortBy === 'sender' && 'font-bold')}>
              <User />
              By Sender
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleSortChange('subject')}
              className={cn(sortBy === 'subject' && 'font-bold')}>
              <FileText />
              By Subject
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
