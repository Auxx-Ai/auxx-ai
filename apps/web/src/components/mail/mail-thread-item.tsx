// apps/web/src/components/mail/mail-thread-item.tsx
'use client'

import React, { useMemo, useCallback } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { getInitialsFromName } from '@auxx/lib/utils'
import DOMPurify from 'dompurify'
import { useDraggable } from '@dnd-kit/core'
import { useMailFilter } from './mail-filter-context'
import { Check, X, MoreVertical, Archive, Trash2, MailWarning } from 'lucide-react'

import { cn } from '@auxx/ui/lib/utils'
import { type ThreadListItem } from './types'
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
import { useThreadMutations } from '~/hooks/use-thread-mutations'
import { WorkflowSubMenu } from '~/components/workflow/workflow-submenu'
/**
 * Processing menu component for triggering manual message processing
 */
function ProcessingMenu({
  messageId,
  threadId,
  organizationId,
  currentStatus,
  threadMutations,
}: {
  messageId: string
  threadId: string
  organizationId: string
  currentStatus?: string
  threadMutations: ReturnType<typeof useThreadMutations>
}) {
  const onSuccess = useCallback(() => {
    // Optionally handle success (e.g., show toast, refresh data)
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
        <WorkflowSubMenu resourceType="thread" resourceId={threadId} onSuccess={onSuccess} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => threadMutations.archiveThread.mutate({ threadId })}
          disabled={threadMutations.archiveThread.isPending}>
          <Archive />
          Archive
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => threadMutations.moveToTrash.mutate({ threadId })}
          disabled={threadMutations.moveToTrash.isPending}
          variant="destructive">
          <Trash2 />
          Trash Thread
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => threadMutations.markAsSpam.mutate({ threadId })}
          disabled={threadMutations.markAsSpam.isPending}>
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
interface MailThreadItemProps {
  /** The thread data object. Expects at least an 'id' property. */
  item: ThreadListItem // Replace 'any' with specific TRPC ThreadListItem type when available
  /** Base URL path for constructing navigation links (though navigation is handled by selection). */
  basePath: string
  /** Indicates if this thread is the currently active one being displayed in detail view. */
  isSelected: boolean
  handleThreadMultiSelect: (threadId: string, event: React.MouseEvent) => void
}

/**
 * Displays a single draggable mail thread item in the list.
 * Handles click events for selection and provides drag functionality.
 */
export function MailThreadItem({
  item,
  basePath, // Keep basePath if needed for other potential link generation, though click handles selection
  isSelected,
  handleThreadMultiSelect,
}: MailThreadItemProps) {
  // --- Hooks ---

  const { selectedThreadIds, contextType, contextId, statusSlug, searchQuery, viewMode } =
    useMailFilter() // Get multi-selection state and view mode from context

  // Get thread mutations for mark as read functionality
  const threadMutations = useThreadMutations(item.id, {
    contextType,
    contextId,
    statusSlug,
    searchQuery,
  })

  // Ensure item and item.id are valid before proceeding
  if (!item?.id) {
    console.error('MailThreadItem rendered without valid item or item.id:', item)
    // return null // Don't render if item or id is missing
  }

  // const isMultiSelected = selectedThreadIds.includes(item.id)
  const isMultiSelected = useMemo(
    () => selectedThreadIds.includes(item.id),
    [selectedThreadIds, item.id]
  )

  // --- Drag and Drop Setup ---
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: item.id,
    data: {
      type: 'thread',
      threadId: item.id,
      // Pass all selected IDs if the dragged item is part of the selection
      get draggedThreadIds() {
        return selectedThreadIds.includes(item.id) ? selectedThreadIds : [item.id]
      },
    },
    disabled: !item.id,
  })
  // Handle click for selecting/multi-selecting threads
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      // Prevent interfering with drag start if click happens during threshold
      if (event.detail > 1) event.preventDefault() // Prevent double-click selection interfering?

      if (viewMode === 'edit') {
        // In edit mode, simulate meta key press to toggle selection instead of navigation
        event.preventDefault()
        // Create a proper synthetic event object with all required methods
        const syntheticEvent = {
          ...event,
          metaKey: true, // Simulate Meta key press to trigger multi-select behavior
          ctrlKey: true, // Also set ctrlKey for cross-platform compatibility
          preventDefault: () => {},
          stopPropagation: () => {},
        }
        handleThreadMultiSelect(item.id, syntheticEvent as React.MouseEvent)
      } else {
        // In view mode, use normal selection behavior (navigation or multi-select with modifiers)
        handleThreadMultiSelect(item.id, event)

        // Mark as read if thread is currently unread (only in view mode for navigation)
        if (item.isUnread) {
          threadMutations.markReadMutation.mutate({ threadId: item.id })
        }
      }

      // NOTE: Navigation to view the thread should be a side effect of the
      // selection state changing (e.g., URL parameter update managed by selection hook or parent)
    },
    [handleThreadMultiSelect, item.id, threadMutations.markReadMutation, item.isUnread, viewMode]
  )
  const formattedDate = useMemo(() => {
    return item.lastMessageAt
      ? formatDistanceToNowStrict(new Date(item.lastMessageAt), { addSuffix: false }) // Simpler format
      : ''
  }, [item.lastMessageAt])

  const latestMessage = item.latestMessage ?? item.messages?.[0] ?? null
  const senderName = useMemo(
    () => latestMessage?.from?.name || latestMessage?.from?.identifier || 'Unknown',
    [latestMessage]
  )
  const snippet = useMemo(() => {
    // Sanitize snippet HTML. Ensure DOMPurify runs client-side only.
    if (typeof window !== 'undefined') {
      return DOMPurify.sanitize(latestMessage?.snippet ?? '', { USE_PROFILES: { html: true } })
    }
    return latestMessage?.snippet ?? '' // Fallback for SSR/initial render
  }, [latestMessage?.snippet])

  const sanitizedCommentContent = useMemo(() => {
    // Sanitize comment content to prevent XSS
    const latestComment = item.latestComment
    if (typeof window !== 'undefined' && latestComment?.content) {
      return DOMPurify.sanitize(latestComment.content, { USE_PROFILES: { html: true } })
    }
    return latestComment?.content ?? ''
  }, [item.latestComment?.content])

  return (
    <div className="flex flex-row items-stretch relative">
      <div
        ref={setNodeRef}
        // style={style}
        {...listeners}
        {...attributes}
        id={`thread-${item.id}`}
        className={cn(
          // Base styles
          'z-2 hover:bg-accent hover:text-accent-foreground dark:border-slate-700  group relative flex w-full cursor-grab flex-col items-start gap-1 rounded-lg border bg-background ps-6 pe-2 py-3 text-left text-sm active:cursor-grabbing dark:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isMultiSelected &&
            'bg-info hover:bg-info-100! text-background shadow-md dark:bg-info dark:hover:bg-info-100  border-info/50 '
        )}
        aria-selected={isMultiSelected}
        onClick={handleClick}
        // Prevent default browser drag behavior which can interfere
        onDragStart={(e) => e.preventDefault()}
        // type="button" // Ensure it's treated as a button
      >
        {/* Unread indicator dot */}
        {item.isUnread && (
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
            // Show checkbox in edit mode
            <Checkbox
              checked={isMultiSelected}
              onCheckedChange={(checked) => {
                // Create a synthetic click event to maintain existing selection logic
                const syntheticEvent = {
                  preventDefault: () => {},
                  stopPropagation: () => {},
                  detail: 1,
                  metaKey: true, // Simulate Meta key press for multi-select behavior
                  ctrlKey: true, // Also set ctrlKey for cross-platform compatibility
                  currentTarget: null,
                  target: null,
                  nativeEvent: null,
                } as React.MouseEvent
                handleThreadMultiSelect(item.id, syntheticEvent)
              }}
              onClick={(e) => e.stopPropagation()} // Prevent bubble to parent click handler
            />
          ) : (
            // Show integration icon in view mode
            // Note: Integration type derived from item.integration.provider
            <div className="flex-none rounded-full border p-0.5 text-blue-500 group-aria-selected:bg-background group-aria-selected:border-info/90">
              {getIntegrationIcon(item.integration?.provider)}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex w-full flex-col gap-1">
          <div className="flex items-center">
            {/* Sender Name */}
            <div className="flex items-center ms-0.5 gap-0.5 overflow-hidden">
              <div className="flex-1 truncate font-semibold group-aria-selected:text-white">
                {senderName}
              </div>
            </div>
            {/* Date */}
            <div className="ml-auto shrink-0 whitespace-nowrap pl-2 text-xs text-muted-foreground group-aria-selected:text-background/50">
              {formattedDate}
            </div>
          </div>
          {/* Subject */}
          <div className="grid-auto-cols-[minmax(auto,max-content)] grid flex-1 grid-flow-col grid-cols-[auto] items-center gap-1">
            <div className="truncate text-xs font-medium group-aria-selected:text-background/80">
              {item.subject || '(no subject)'}
            </div>
            <div>
              <div className="flex items-center justify-end gap-1 overflow-hidden">
                {item.tags?.length > 0 &&
                  item.tags.map((tag: ThreadListItem['tags'][number]) => getTagForThread(tag))}
              </div>
            </div>
          </div>
        </div>
        <div
          className="line-clamp-2 w-full break-words text-xs text-muted-foreground group-aria-selected:text-background/50"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
        {item.latestComment && (
          <div className="">
            <div className="flex min-w-0 items-center gap-1 rounded-[10px] bg-[rgba(93,105,133,0.18)] pe-2 text-xs group-aria-selected:text-background group-aria-selected:bg-background/20">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(93,105,133,0.5)] text-xs text-white group-aria-selected:bg-background/30">
                {getInitialsFromName(item.latestComment.createdBy.name)}
              </span>
              <div
                className="text-foreground/80 group-aria-selected:text-white/50"
                dangerouslySetInnerHTML={{ __html: sanitizedCommentContent }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Processing menu */}

      {/* Shown if in action mode  */}
      <div className="z-1 me-0.5 relative border-primary-500 rounded-r-lg -ms-1.5 ps-2 py-0.5 pe-0.5 bg-primary-200 dark:bg-slate-800 flex flex-row shrink-0 ">
        <div
          className="absolute inset-0 rounded-r-lg pointer-events-none  mask-y-from-98% mask-y-to-100%"
          style={{ boxShadow: 'inset 25px 0 25px -25px #000, 1px 1px 3px rgba(0,0,0,0.2)' }}></div>
        <div className="flex flex-col justify-start h-full ">
          {/* approve */}
          {latestMessage && (
            <ProcessingMenu
              messageId={latestMessage.id}
              threadId={item.id}
              organizationId={item.organizationId || latestMessage.organizationId}
              currentStatus={undefined}
              threadMutations={threadMutations}
            />
          )}
          {/* <Button
            variant="ghost"
            size="sm"
            className="size-7 hover:bg-good-100 hover:text-good-900 text-muted-foreground">
            <Check className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 hover:border-bad-500 text-muted-foreground  hover:bg-bad-100 hover:text-bad-900 ">
            <X className="size-4" />
          </Button> */}
        </div>
      </div>
    </div>
  )
}

/** Renders a visual chip for a thread tag. */
function getTagForThread(tag: ThreadListItem['tags'][number]): React.ReactNode {
  const name = tag.title
  // Add logic here to map label names/properties to Badge variants/colors
  return (
    <div
      key={tag.id}
      className={`flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border  px-[3px] py-[1px] text-xs text-muted-foreground group-aria-selected:text-background/80 group-aria-selected:border-black/20  `}>
      {tag.emoji} {name}
    </div>
  )
}

// --- END OF FILE ~/components/mail/mail-thread-item.tsx ---
