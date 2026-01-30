// apps/web/src/components/mail/mail-thread-item.tsx
'use client'

import React, { useMemo, useCallback } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import DOMPurify from 'dompurify'
import { useDraggable } from '@dnd-kit/core'
import { useMailFilter } from './mail-filter-context'
import { MoreVertical, Archive, Trash2, MailWarning } from 'lucide-react'

import { cn } from '@auxx/ui/lib/utils'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { getIntegrationIcon } from './mail-status-config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { WorkflowSubMenu } from '~/components/workflow/workflow-submenu'
import { toRecordId } from '@auxx/types/resource'
import { api } from '~/trpc/react'

// NEW: Import from new hooks
import { useThread, useMessage, useThreadReadStatus, useThreadDraftStatus, useThreadMutation } from '~/components/threads/hooks'
import { useThreadSelectionStore, type ThreadTagSummary } from '~/components/threads/store'

/**
 * Processing menu component for triggering manual message processing
 */
function ProcessingMenu({
  threadId,
  update,
  isUpdating,
}: {
  threadId: string
  update: (threadId: string, updates: { status?: 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH' }) => void
  isUpdating: boolean
}) {
  const onSuccess = useCallback(() => {
    console.log('Workflow triggered successfully')
  }, [])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="rounded-[8px]!">
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <WorkflowSubMenu recordId={toRecordId('thread', threadId)} onSuccess={onSuccess} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => update(threadId, { status: 'ARCHIVED' })}
          disabled={isUpdating}>
          <Archive />
          Archive
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => update(threadId, { status: 'TRASH' })}
          disabled={isUpdating}
          variant="destructive">
          <Trash2 />
          Trash Thread
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => update(threadId, { status: 'SPAM' })}
          disabled={isUpdating}>
          <MailWarning />
          Mark as spam
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Props for the MailThreadItem component.
 */
export interface MailThreadItemProps {
  /** Thread ID to fetch and display */
  threadId: string
  /** Base URL path for constructing navigation links */
  basePath: string
  /** Indicates if this thread is the currently active one being displayed in detail view */
  isSelected: boolean
  /** Handler for thread click with selection support */
  handleThreadClick: (threadId: string, event: React.MouseEvent) => void
}

/**
 * Displays a single draggable mail thread item in the list.
 * Uses new hooks architecture to fetch thread and message data.
 */
export function MailThreadItem({
  threadId,
  basePath: _basePath,
  isSelected: _isSelected,
  handleThreadClick,
}: MailThreadItemProps) {
  // --- Get filter context ---
  const { selectedThreadIds, contextType, contextId, statusSlug, searchQuery, viewMode } =
    useMailFilter()

  // --- NEW: Use ID-based hooks ---
  const { thread, isLoading: isThreadLoading } = useThread({ threadId })
  const { message: latestMessage } = useMessage({
    messageId: thread?.latestMessageId,
    enabled: !!thread?.latestMessageId,
  })
  const { isUnread } = useThreadReadStatus(threadId)
  const { hasDraft } = useThreadDraftStatus(threadId)

  // --- Selection store actions ---
  const toggleSelection = useThreadSelectionStore((s) => s.toggleSelection)
  const setActiveThread = useThreadSelectionStore((s) => s.setActiveThread)

  // --- Thread mutations using new unified hook ---
  const { update, isUpdating } = useThreadMutation()

  // Keep markAsRead separate (used when clicking on thread)
  const markReadMutation = api.thread.markAsRead.useMutation()

  // --- Selection state ---
  const isMultiSelected = useMemo(
    () => selectedThreadIds.includes(threadId),
    [selectedThreadIds, threadId]
  )

  // --- Drag and Drop Setup ---
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: threadId,
    data: {
      type: 'thread',
      threadId,
      get draggedThreadIds() {
        return selectedThreadIds.includes(threadId) ? selectedThreadIds : [threadId]
      },
    },
    disabled: !threadId,
  })

  // --- Click handler ---
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.detail > 1) event.preventDefault()

      if (viewMode === 'edit') {
        event.preventDefault()
        toggleSelection(threadId)
        setActiveThread(threadId)
      } else {
        handleThreadClick(threadId, event)

        // Mark as read if thread is currently unread
        if (isUnread) {
          markReadMutation.mutate({ threadId })
        }
      }
    },
    [handleThreadClick, threadId, markReadMutation, isUnread, viewMode, toggleSelection, setActiveThread]
  )

  // --- Derived values ---
  const formattedDate = useMemo(() => {
    return thread?.lastMessageAt
      ? formatDistanceToNowStrict(new Date(thread.lastMessageAt), { addSuffix: false })
      : ''
  }, [thread?.lastMessageAt])

  const senderName = useMemo(
    () => latestMessage?.from?.name || latestMessage?.from?.identifier || 'Unknown',
    [latestMessage?.from]
  )

  const snippet = useMemo(() => {
    if (typeof window !== 'undefined' && latestMessage?.snippet) {
      return DOMPurify.sanitize(latestMessage.snippet, { USE_PROFILES: { html: true } })
    }
    return latestMessage?.snippet ?? ''
  }, [latestMessage?.snippet])

  // --- Loading state ---
  if (isThreadLoading || !thread) {
    return <ThreadItemSkeleton />
  }

  return (
    <div className="flex flex-row items-stretch relative">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        id={`thread-${threadId}`}
        className={cn(
          'z-2 hover:bg-accent hover:text-accent-foreground dark:border-slate-700 group relative flex w-full cursor-grab flex-col items-start gap-1 rounded-lg border bg-background ps-6 pe-2 py-3 text-left text-sm active:cursor-grabbing dark:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isMultiSelected &&
            'bg-info hover:bg-info-100! text-background shadow-md dark:bg-info dark:hover:bg-info-100 border-info/50'
        )}
        aria-selected={isMultiSelected}
        onClick={handleClick}
        onDragStart={(e) => e.preventDefault()}>
        {/* Unread indicator dot */}
        {isUnread && (
          <div
            className={cn(
              'absolute left-2 top-9 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500',
              isMultiSelected && 'bg-white'
            )}
            aria-label="Unread message"
          />
        )}

        <div className="absolute top-3 left-1">
          {viewMode === 'edit' ? (
            <div
              onClick={(e) => {
                e.stopPropagation()
                toggleSelection(threadId)
                setActiveThread(threadId)
              }}>
              <Checkbox checked={isMultiSelected} />
            </div>
          ) : (
            <div className="flex-none rounded-full border p-0.5 text-blue-500 group-aria-selected:bg-background group-aria-selected:border-info/90">
              {getIntegrationIcon(thread.integrationProvider)}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex w-full flex-col gap-1">
          <div className="flex items-center">
            <div className="flex items-center ms-0.5 gap-0.5 overflow-hidden">
              <div className="flex-1 truncate font-semibold group-aria-selected:text-white">
                {senderName}
              </div>
            </div>
            <div className="ml-auto shrink-0 whitespace-nowrap pl-2 text-xs text-muted-foreground group-aria-selected:text-background/50">
              {formattedDate}
            </div>
          </div>

          {/* Subject */}
          <div className="grid-auto-cols-[minmax(auto,max-content)] grid flex-1 grid-flow-col grid-cols-[auto] items-center gap-1">
            <div className="truncate text-xs font-medium group-aria-selected:text-background/80">
              {thread.subject || '(no subject)'}
            </div>
            <div>
              <div className="flex items-center justify-end gap-1 overflow-hidden">
                {hasDraft && (
                  <div
                    className={cn(
                      'flex items-center gap-1 whitespace-nowrap rounded-[5px] border px-[3px] py-[1px] text-xs text-red-600 border-red-300 bg-red-50',
                      isMultiSelected && 'text-red-200 border-red-200/50 bg-transparent'
                    )}>
                    Draft
                  </div>
                )}
                {thread.tags?.map((tag) => (
                  <ThreadTag key={tag.id} tag={tag} isMultiSelected={isMultiSelected} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          className="line-clamp-2 w-full break-words text-xs text-muted-foreground group-aria-selected:text-background/50"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      </div>

      {/* Processing menu */}
      <div className="z-1 me-0.5 relative border-primary-500 rounded-r-lg -ms-1.5 ps-2 py-0.5 pe-0.5 bg-primary-200 dark:bg-slate-800 flex flex-row shrink-0">
        <div
          className="absolute inset-0 rounded-r-lg pointer-events-none mask-y-from-98% mask-y-to-100%"
          style={{ boxShadow: 'inset 25px 0 25px -25px #000, 1px 1px 3px rgba(0,0,0,0.2)' }}
        />
        <div className="flex flex-col justify-start h-full">
          <ProcessingMenu threadId={threadId} update={update} isUpdating={isUpdating} />
        </div>
      </div>
    </div>
  )
}

/** Skeleton for loading thread item */
function ThreadItemSkeleton() {
  return (
    <div className="flex flex-row items-stretch relative">
      <div className="z-2 group relative flex w-full flex-col items-start gap-1 rounded-lg border bg-background ps-6 pe-2 py-3">
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  )
}

/** Renders a visual chip for a thread tag */
function ThreadTag({ tag, isMultiSelected }: { tag: ThreadTagSummary; isMultiSelected: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border px-[3px] py-[1px] text-xs text-muted-foreground',
        isMultiSelected && 'text-background/80 border-black/20'
      )}>
      {tag.tag_emoji} {tag.title}
    </div>
  )
}
