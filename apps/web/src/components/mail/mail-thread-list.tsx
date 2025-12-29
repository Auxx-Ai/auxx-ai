import React, { useEffect, useRef, useMemo } from 'react'
import { format } from 'date-fns'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useInView } from 'react-intersection-observer'

import { MailThreadItem } from './mail-thread-item'
import { Skeleton } from '@auxx/ui/components/skeleton' // For loading state
import { ChevronDown, Loader2, Clock, User, FileText, ArrowUpDown } from 'lucide-react'
import type { ThreadListItem, ThreadsFilterInput } from './types'
import useThreads from '~/hooks/use-threads-filter'
import useThreadSelection from '../kbar/use-thread-selection'
import { useUser } from '~/hooks/use-user'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { useMailFilter, type ViewMode, type SortOption } from './mail-filter-context'
import { cn } from '@auxx/ui/lib/utils'

interface ThreadListProps {
  filter: ThreadsFilterInput // The filter object for fetching threads
  basePath: string // Base URL path for constructing thread links (e.g., /app/mail/inbox/open)
  selectedThreadId?: string | null // ID of the currently selected thread from URL search param
  onLoadingChange?: (isLoading: boolean) => void // Add this
}

export function ThreadList({
  filter,
  basePath,
  selectedThreadId,
  onLoadingChange,
}: ThreadListProps) {
  const {
    threads,
    isLoading, // Represents initial fetch loading state
    isFetchingNextPage, // Represents loading state for subsequent pages
    fetchNextPage,
    hasNextPage,
    status, // Detailed query status ('loading', 'error', 'success')
    error, // Query error object
    refetch, // Function to manually refetch
  } = useThreads(filter) // Pass filter to the data-fetching hook

  const { handleThreadMultiSelect, clearSelection, selectedThreads, setSelectedThreadIds } =
    useThreadSelection({
      contextType: filter.contextType,
      contextId: filter.contextId,
      statusSlug: filter.statusSlug,
      searchQuery: filter.searchQuery,
    }) // Get the selection handler function and other selection utilities

  // Get organizationId
  const { organizationId } = useUser()

  // Auto-animation for list changes
  const [parent] = useAutoAnimate<HTMLDivElement>()

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isLoading || isFetchingNextPage)
    }
  }, [isLoading, isFetchingNextPage, onLoadingChange])

  // State from Vim hook (optional, keep if needed)
  const container = useRef(null)
  // const ref = useRef(null)
  // const isInView = useInView(ref, { amount: 0.8, initial: false, margin: '0px' })
  const { ref, inView } = useInView({ threshold: 0 })
  useEffect(() => {
    if (inView) {
      fetchNextPage()
    }
  }, [inView, fetchNextPage, hasNextPage, isFetchingNextPage])

  // Memoize grouping threads by date to prevent recalculation on every render
  const groupedThreads = useMemo(() => {
    return (
      threads?.reduce(
        (acc, thread) => {
          const date = format(thread.lastMessageAt ?? new Date(), 'yyyy-MM-dd')
          if (!acc[date]) {
            acc[date] = []
          }
          acc[date].push(thread)
          return acc
        },
        {} as Record<string, ThreadListItem[]> // Use inferred type 'typeof threads'
      ) ?? {}
    ) // Default to empty object if threads is undefined
  }, [threads])

  // Render skeleton loaders during initial data fetch
  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[...Array(10)].map((_, i) => (
          <div key={`skel-${i}`} className="flex items-start space-x-3 rounded-lg border p-3">
            {/* <Skeleton className="h-8 w-8 rounded-full shrink-0" /> */}
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
        ))}
      </div>
    )
  }

  // Render error state if data fetching failed
  if (status === 'error') {
    return (
      <div className="p-8 text-center text-destructive">
        <p>Error loading threads: {error?.message || 'Unknown error'}</p>
        <button onClick={() => refetch()} className="mt-4 text-foreground underline">
          Try again
        </button>
      </div>
    )
  }

  // Condition for empty state - used to conditionally apply flex-1 for centering
  const isEmpty = threads.length === 0 && !isFetchingNextPage

  return (
    <div className={cn('relative flex h-full w-full flex-col', isEmpty && 'flex-1')}>
      <div className={cn('overflow-y-auto', isEmpty && 'flex-1 flex flex-col')} ref={container}>
        <ThreadListMenu
          selectAll={() => {
            if (threads && threads.length > 0) {
              setSelectedThreadIds(threads.map((t) => t.id))
            }
          }}
          clearSelection={clearSelection}
          selectedThreads={selectedThreads}
          totalThreads={threads?.length || 0}
        />

        <div className={cn('relative flex flex-col gap-2 p-4 pt-0', isEmpty && 'flex-1')} ref={parent}>
          {/* Message when no threads are found */}
          {threads.length === 0 && !isFetchingNextPage && (
            <div className="p-8 text-center text-muted-foreground h-full flex items-center justify-center border rounded-2xl ring-inset ring-1 ring-muted/10">
              No threads found in this view.
            </div>
          )}

          {/* Iterate over grouped threads */}
          {Object.entries(groupedThreads).map(([date, dateThreads]) => (
            <React.Fragment key={date}>
              {/* Sticky Date Header */}
              <div
                className="sticky top-10 z-10  text-xs font-medium text-muted-foreground first:mt-0 bg-secondary dark:bg-primary-100 mask-b-from-80% mask-b-to-100%"
                style={
                  {
                    // transition: 'background .24s cubic-bezier(.28,.11,.32,1)',
                    // background: 'rgba(250, 250, 252, .8)',
                    // backdropFilter: 'saturate(180%) blur(20px)',
                  }
                }>
                {format(new Date(date), 'MMMM d, yyyy')}
              </div>
              {dateThreads.map((item) => (
                <MailThreadItem
                  key={item.id}
                  item={item as any} // Cast or adjust type if needed
                  basePath={basePath}
                  isSelected={item.id === selectedThreadId}
                  handleThreadMultiSelect={handleThreadMultiSelect}
                />
              ))}
            </React.Fragment>
          ))}
          {isFetchingNextPage && (
            <div className="flex h-8 w-full items-center justify-center">
              <div>
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
          {/* {hasNextPage && (
            <Button variant="ghost" className="" onClick={() => fetchNextPage()}>
              Load more...
            </Button>
          )} */}
        </div>
        {/* <div className="absolute w-full bottom-0 h-[50px] mask-y-from-50% bg-white border-t border-black z-10"></div> */}
        <div ref={ref} className="h-1"></div>
        {!hasNextPage && threads.length > 0 && !isFetchingNextPage && (
          <div className="pb-8 pt-4 text-center text-sm text-muted-foreground">End of list.</div>
        )}
      </div>
    </div>
  )
}
interface ThreadListMenuProps {
  selectAll: () => void
  clearSelection: () => void
  selectedThreads: string[]
  totalThreads: number
}

function ThreadListMenu({
  selectAll,
  clearSelection,
  selectedThreads,
  totalThreads,
}: ThreadListMenuProps) {
  const { viewMode, setViewMode, sortBy, setSortBy, setSortDirection } = useMailFilter()

  // Check if all threads are selected using proper counts
  const selectedCount = selectedThreads.length
  const allSelected = totalThreads > 0 && selectedCount === totalThreads
  const someSelected = selectedCount > 0 && selectedCount < totalThreads

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelection()
    } else {
      selectAll()
    }
  }

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode?.(mode)
  }

  const handleSortChange = (sort: SortOption) => {
    setSortBy?.(sort)
    // Auto-set direction based on sort type
    if (sort === 'newest') {
      setSortDirection?.('desc')
    } else if (sort === 'oldest') {
      setSortDirection?.('desc') // Will be inverted in backend
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
          onClick={() => {
            handleViewModeChange(viewMode === 'edit' ? 'view' : 'edit')
          }}
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
