// apps/web/src/components/mail/mail-thread-list.tsx
'use client'

import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowUpDown, ChevronDown, Clock, FileText, Loader2, Mail, User } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
// import { useAutoAnimate } from '@formkit/auto-animate/react'
// NEW: Import selection hooks from threads module
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useThreadTags } from '~/components/tags/hooks/use-thread-tags'
import { TagPicker } from '~/components/tags/ui/tag-picker'
import {
  useFocusedThreadShortcuts,
  useSelectionReset,
  useThreadKeyboardNav,
  useThreadList,
  useThreadMutation,
  useThreadSelection,
} from '~/components/threads/hooks'
import type { ViewMode } from '~/components/threads/store'
import {
  useSelectedThreadIds,
  useThreadSelectionStore,
  useViewMode,
} from '~/components/threads/store'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { api } from '~/trpc/react'
import BulkActionToolbar from './bulk-action-toolbar'
import { CompactDraftItem } from './compact-draft-item'
import { CompactThreadItem } from './compact-thread-item'
import { type SortOption, useMailFilter } from './mail-filter-context'
import { MailThreadItem } from './mail-thread-item'
import { StandaloneDraftItem } from './standalone-draft-item'
import type { ThreadsFilterInput } from './types'

export type ThreadListVariant = 'default' | 'compact'

interface ThreadListProps {
  /** Filter configuration for fetching threads */
  filter: ThreadsFilterInput
  /** Base URL path for constructing thread links */
  basePath: string
  /** ID of the currently selected thread from URL search param */
  selectedThreadId?: string | null
  /** Callback when loading state changes */
  onLoadingChange?: (isLoading: boolean) => void
  /** Layout variant: 'default' (card style) or 'compact' (single-line rows) */
  variant?: ThreadListVariant
}

/**
 * Displays a list of thread items with infinite scroll pagination.
 * Uses the new ID-based architecture for improved performance.
 * Memoized to prevent unnecessary re-renders from parent components.
 */
export const ThreadList = memo(function ThreadList({
  filter,
  basePath,
  selectedThreadId,
  onLoadingChange,
  variant = 'default',
}: ThreadListProps) {
  const [, setTid] = useQueryState('tid', { defaultValue: '', history: 'replace', shallow: true })
  const utils = api.useUtils()
  const { contextType, contextId, statusSlug, searchQuery } = useMailFilter()

  // Use ID-based hook with unified condition-based filter
  const {
    recordIds,
    threadIds,
    total,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refresh,
  } = useThreadList({
    filter: filter.filter,
    sort: filter.sort,
  })
  // Selection hooks - use new thread selection system (for threads only)
  const { handleThreadClick } = useThreadSelection({ threadIds })

  // Keep store in sync with current list thread IDs for navigation toolbar
  const setListThreadIds = useThreadSelectionStore((s) => s.setListThreadIds)
  useEffect(() => {
    setListThreadIds(threadIds)
  }, [threadIds, setListThreadIds])

  // Keyboard navigation - handles arrow keys, Home/End, Cmd+A, Escape, etc.
  useThreadKeyboardNav({
    threadIds,
    enabled: true,
    mode: variant === 'compact' ? 'focus' : 'navigate',
    onNavigateToEnd: () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    onOpen: variant === 'compact' ? (id) => void setTid(id) : undefined,
  })

  // Action shortcuts (D, #, !, W, L) for focused thread in compact view
  const {
    workflowDialogOpen,
    handleWorkflowDialogOpenChange,
    workflowThreadId,
    tagPickerOpen,
    handleTagPickerOpenChange,
    tagPickerThreadId,
    openTagPicker,
    assignPickerOpen,
    handleAssignPickerOpenChange,
    assignPickerThreadId,
    openAssignPicker,
  } = useFocusedThreadShortcuts()

  // Anchor ref for tag picker popover — points to the focused thread's DOM element
  const tagAnchorRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (tagPickerThreadId && tagPickerOpen) {
      tagAnchorRef.current = document.getElementById(`thread-${tagPickerThreadId}`) ?? null
    }
  }, [tagPickerThreadId, tagPickerOpen])

  // Tag management for focused thread — optimistic updates via ThreadStore
  const { selectedTags: tagPickerCurrentTags, handleTagChange: handleFocusedTagChange } =
    useThreadTags(tagPickerThreadId ?? '')

  // Anchor ref for assign picker popover — points to the focused thread's DOM element
  const assignAnchorRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (assignPickerThreadId && assignPickerOpen) {
      assignAnchorRef.current = document.getElementById(`thread-${assignPickerThreadId}`) ?? null
    }
  }, [assignPickerThreadId, assignPickerOpen])

  // Assign handler for focused thread
  const { update: updateThread } = useThreadMutation()
  const handleFocusedAssign = useCallback(
    (actorIds: string[]) => {
      if (assignPickerThreadId && actorIds.length > 0) {
        updateThread(assignPickerThreadId, { assigneeId: actorIds[0] })
      }
    },
    [assignPickerThreadId, updateThread]
  )

  // Reset selection when filter changes
  useSelectionReset(filter.filter)

  // Auto-animation disabled for performance during resize
  // TODO: Re-enable with resize-aware toggle if needed
  const parent = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isLoading || isFetchingNextPage)
    }
  }, [isLoading, isFetchingNextPage, onLoadingChange])

  // Infinite scroll: IntersectionObserver with viewport as root.
  const [scrollViewport, setScrollViewport] = useState<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const fetchNextPageRef = useRef(fetchNextPage)
  fetchNextPageRef.current = fetchNextPage
  const hasNextPageRef = useRef(hasNextPage)
  hasNextPageRef.current = hasNextPage
  const isFetchingRef = useRef(isFetchingNextPage)
  isFetchingRef.current = isFetchingNextPage
  const observerRef = useRef<IntersectionObserver | null>(null)
  // Guard: count consecutive auto-fetches without user scroll; reset on scroll
  const autoFetchCount = useRef(0)
  const MAX_AUTO_FETCHES = 5

  // Callback ref to capture the viewport element via state
  const viewportRefCallback = useCallback((el: HTMLDivElement | null) => {
    setScrollViewport(el)
  }, [])

  // Reset auto-fetch counter on user scroll
  useEffect(() => {
    if (!scrollViewport) return
    const reset = () => {
      autoFetchCount.current = 0
    }
    scrollViewport.addEventListener('scroll', reset, { passive: true })
    return () => scrollViewport.removeEventListener('scroll', reset)
  }, [scrollViewport])

  // Create IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!scrollViewport || !sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          hasNextPageRef.current &&
          !isFetchingRef.current &&
          autoFetchCount.current < MAX_AUTO_FETCHES
        ) {
          autoFetchCount.current++
          fetchNextPageRef.current()
        }
      },
      { root: scrollViewport, threshold: 0 }
    )

    observerRef.current = observer
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [scrollViewport])

  // After a fetch completes, re-observe sentinel to trigger a fresh
  // intersection check (the observer only fires on state *changes*,
  // so we need to disconnect + re-observe to re-evaluate).
  useEffect(() => {
    if (isFetchingNextPage || !hasNextPage) return
    const observer = observerRef.current
    const sentinel = sentinelRef.current
    if (!observer || !sentinel) return

    if (autoFetchCount.current >= MAX_AUTO_FETCHES) {
      console.warn('[ThreadList] Auto-fetch limit reached — waiting for user scroll.', {
        pages: recordIds.length,
        autoFetchCount: autoFetchCount.current,
      })
      return
    }

    // Disconnect + re-observe forces the observer callback to fire
    // with the sentinel's current intersection state.
    observer.unobserve(sentinel)
    observer.observe(sentinel)
  }, [isFetchingNextPage, hasNextPage, recordIds.length])

  // Loading state
  if (isLoading) {
    return (
      <div className='space-y-4 p-4'>
        {[...Array(10)].map((_, i) => (
          <ThreadItemSkeleton key={`skel-${i}`} />
        ))}
      </div>
    )
  }

  const isEmpty = recordIds.length === 0 && !isFetchingNextPage

  return (
    <div className={cn('relative flex h-full w-full flex-col', isEmpty && 'flex-1')}>
      <ThreadListMenu threadIds={threadIds} />
      <BulkActionToolbar />
      {workflowThreadId && (
        <MassWorkflowTriggerDialog
          open={workflowDialogOpen}
          onOpenChange={handleWorkflowDialogOpenChange}
          recordIds={[toRecordId('thread', workflowThreadId)]}
          onSuccess={() => {
            utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
          }}
        />
      )}
      {tagPickerOpen && tagPickerThreadId && (
        <TagPicker
          open={tagPickerOpen}
          onOpenChange={handleTagPickerOpenChange}
          anchorRef={tagAnchorRef}
          selectedTags={tagPickerCurrentTags}
          onChange={handleFocusedTagChange}
          allowMultiple
          align='end'
          side='bottom'
        />
      )}
      {assignPickerOpen && assignPickerThreadId && (
        <ActorPicker
          open={assignPickerOpen}
          onOpenChange={handleAssignPickerOpenChange}
          anchorRef={assignAnchorRef}
          onChange={handleFocusedAssign}
          emptyLabel='Assign'
          align='end'
          side='bottom'
        />
      )}
      <ScrollArea
        viewportRef={viewportRefCallback}
        scrollbarClassName='w-1!'
        className={cn('flex-1 min-h-0', isEmpty && 'flex flex-col')}>
        <div
          className={cn(
            'relative flex flex-col pt-0',
            variant === 'compact' ? 'gap-0 px-0' : 'gap-2 p-4',
            isEmpty && 'flex-1'
          )}
          ref={parent}>
          {isEmpty && (
            <div className='p-4 text-center flex-1 flex items-center justify-center border rounded-2xl ring-inset ring-1 ring-muted/10'>
              <Empty className=' md:p-3'>
                <EmptyHeader className='gap-0'>
                  <EmptyMedia variant='icon'>
                    <Mail />
                  </EmptyMedia>
                  <EmptyTitle>Nothing here</EmptyTitle>
                  <EmptyDescription>No threads found in this view.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )}

          {/* Render list items - route based on entity type */}
          {recordIds.map((recordId) => {
            const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

            if (entityDefinitionId === 'draft') {
              if (variant === 'compact') {
                return <CompactDraftItem key={recordId} draftId={entityInstanceId} />
              }
              return <StandaloneDraftItem key={recordId} draftId={entityInstanceId} />
            }

            if (variant === 'compact') {
              return (
                <CompactThreadItem
                  key={recordId}
                  threadId={entityInstanceId}
                  basePath={basePath}
                  isSelected={entityInstanceId === selectedThreadId}
                  handleThreadClick={handleThreadClick}
                  threadIds={threadIds}
                  onTagClick={openTagPicker}
                  onAssignClick={openAssignPicker}
                />
              )
            }

            return (
              <MailThreadItem
                key={recordId}
                threadId={entityInstanceId}
                basePath={basePath}
                isSelected={entityInstanceId === selectedThreadId}
                handleThreadClick={handleThreadClick}
                threadIds={threadIds}
              />
            )
          })}

          {isFetchingNextPage && (
            <div className='flex h-8 w-full items-center justify-center'>
              <Loader2 className='h-4 w-4 animate-spin' />
            </div>
          )}
        </div>

        <div ref={sentinelRef} className='h-1' />
        {!hasNextPage && recordIds.length > 0 && !isFetchingNextPage && (
          <div className='pb-8 pt-4 text-center text-sm text-muted-foreground'>End of list.</div>
        )}
      </ScrollArea>
    </div>
  )
})

/** Skeleton for loading thread items */
function ThreadItemSkeleton() {
  return (
    <div className='flex items-start space-x-3 rounded-lg border p-3'>
      <div className='grow space-y-2'>
        <div className='flex justify-between'>
          <Skeleton className='h-4 w-3/5' />
          <Skeleton className='h-3 w-16' />
        </div>
        <Skeleton className='h-3 w-2/5' />
        <Skeleton className='h-3 w-full' />
        <Skeleton className='h-3 w-4/5' />
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
    <div className='sticky top-0 py-3 z-10 h-10 sm:mr-3 flex flex-row items-center justify-between pl-4 bg-secondary dark:bg-muted-50 mask-b-from-80% mask-b-to-100%'>
      <div className='flex items-center justify-start flex-row gap-2'>
        <div className='flex items-center justify-center rounded-full font-medium transition-colors text-xs py-0 w-[97px]'>
          {viewMode === 'edit' && (
            <div
              className='ps-3 pe-2 border border-r-0 h-6 rounded-full rounded-r-none flex items-center justify-center cursor-pointer hover:bg-foreground/10'
              onClick={handleSelectAll}>
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                className='pointer-events-none'
              />
            </div>
          )}

          <Button
            variant='ghost'
            size='xs'
            onClick={() => handleViewModeChange(viewMode === 'edit' ? 'view' : 'edit')}
            className={cn(
              'border h-6 flex text-muted-foreground px-2 hover:bg-foreground/10 flex-1',
              viewMode === 'edit' ? 'rounded-full rounded-l-none' : 'rounded-full'
            )}>
            {viewMode === 'edit' ? 'Edit' : 'View'}
            <ChevronDown className='size-3 ml-auto' />
          </Button>
        </div>
        {viewMode === 'edit' && selectedCount > 0 && (
          <div className='px-2 flex items-center border bg-red-400 dark:bg-bad-300 border-black/5 h-5.5 rounded-full text-xs text-white'>
            {selectedCount}
          </div>
        )}
      </div>
      <div className='flex flex-row items-center gap-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='xs'
              className='rounded-full hover:bg-foreground/10 w-[130px] justify-start'>
              <ArrowUpDown className='size-3 mr-1' />
              {getSortLabel()}
              <ChevronDown className='size-3 ml-auto' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-36'>
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
