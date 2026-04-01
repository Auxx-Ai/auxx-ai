// apps/web/src/components/mail/mail-thread-item.tsx
'use client'

import { evaluateConditions, normalizeStatusConditions } from '@auxx/lib/conditions/client'
import { toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { OverflowRow } from '@auxx/ui/components/overflow-row'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import { formatDistanceToNowStrict } from 'date-fns'
import DOMPurify from 'dompurify'
import { Archive, Ban, Clock, MailWarning, MoreVertical, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import { memo, useCallback, useMemo } from 'react'
import { TagBadge } from '~/components/tags/ui/tag-badge'
// NEW: Import from new hooks
import {
  useMessage,
  useMessageParticipants,
  useThread,
  useThreadMutation,
  useThreadReadStatus,
} from '~/components/threads/hooks'
import { useSelectionAnchorId, useThreadSelectionStore } from '~/components/threads/store'
import { threadFieldResolver } from '~/components/threads/utils/thread-field-resolver'
import { WorkflowSubMenu } from '~/components/workflow/workflow-submenu'
import { api } from '~/trpc/react'
import { useMailFilter } from './mail-filter-context'
import { getIntegrationIcon } from './mail-status-config'

/**
 * Processing menu component for triggering manual message processing
 */
export function ProcessingMenu({
  threadId,
  integrationId,
  senderEmail,
  update,
  isUpdating,
  onOpenChange,
}: {
  threadId: string
  integrationId?: string
  senderEmail?: string
  update: (
    threadId: string,
    updates: { status?: 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH' | 'IGNORED' }
  ) => void
  isUpdating: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const onSuccess = useCallback(() => {
    console.log('Workflow triggered successfully')
  }, [])

  const addExcludedSender = api.channel.addExcludedSender.useMutation({
    onSuccess: () => {
      update(threadId, { status: 'IGNORED' })
    },
  })

  const senderDomain = senderEmail?.split('@')[1]
  const showIgnoreFrom = integrationId && senderEmail && senderDomain

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon-sm' className='rounded-[8px]!'>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <WorkflowSubMenu recordId={toRecordId('thread', threadId)} onSuccess={onSuccess} />
        <DropdownMenuSeparator />
        {showIgnoreFrom && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Ban />
                Ignore from
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => addExcludedSender.mutate({ integrationId, entry: senderEmail })}
                  disabled={addExcludedSender.isPending}>
                  {senderEmail}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => addExcludedSender.mutate({ integrationId, entry: senderDomain })}
                  disabled={addExcludedSender.isPending}>
                  @{senderDomain}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => update(threadId, { status: 'ARCHIVED' })}
          disabled={isUpdating}>
          <Archive />
          Archive
          <DropdownMenuShortcut>D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => update(threadId, { status: 'TRASH' })}
          disabled={isUpdating}
          variant='destructive'>
          <Trash2 />
          Trash Thread
          <DropdownMenuShortcut>#</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => update(threadId, { status: 'SPAM' })}
          disabled={isUpdating}>
          <MailWarning />
          Mark as spam
          <DropdownMenuShortcut>!</DropdownMenuShortcut>
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
  /** All thread IDs in display order, needed for shift+click range selection */
  threadIds: string[]
}

/**
 * Displays a single draggable mail thread item in the list.
 * Uses new hooks architecture to fetch thread and message data.
 * Memoized to prevent unnecessary re-renders during parent updates.
 */
export const MailThreadItem = memo(function MailThreadItem({
  threadId,
  basePath: _basePath,
  isSelected: _isSelected,
  handleThreadClick,
  threadIds,
}: MailThreadItemProps) {
  // --- Get filter context ---
  const { selectedThreadIds, viewMode, filterConditions } = useMailFilter()

  // --- NEW: Use ID-based hooks ---
  const { thread, isLoading: isThreadLoading } = useThread({ threadId })
  const { message: latestMessage } = useMessage({
    messageId: thread?.latestMessageId,
    enabled: !!thread?.latestMessageId,
  })
  const { from: senderParticipant } = useMessageParticipants(latestMessage?.participants ?? [])
  const { isUnread, markAsRead } = useThreadReadStatus(threadId)

  // --- Selection store actions ---
  const toggleSelection = useThreadSelectionStore((s) => s.toggleSelection)
  const setActiveThread = useThreadSelectionStore((s) => s.setActiveThread)
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setSelectionAnchor)
  const selectRange = useThreadSelectionStore((s) => s.selectRange)
  const selectionAnchorId = useSelectionAnchorId()

  // --- Thread mutations using new unified hook ---
  const { update, isUpdating } = useThreadMutation()

  // --- Client-side filtering for optimistic updates ---
  // Normalize virtual status values (assigned/unassigned/done) into DB-level conditions
  const normalizedConditions = useMemo(
    () => normalizeStatusConditions(filterConditions),
    [filterConditions]
  )

  // Evaluate if this thread matches the current filter conditions
  const matchesFilter = useMemo(() => {
    if (!thread) return true // Show loading state
    return evaluateConditions(thread, normalizedConditions, threadFieldResolver)
  }, [thread, normalizedConditions])

  // Draft status is now embedded in ThreadMeta
  const hasDraft = (thread?.draftIds?.length ?? 0) > 0
  const hasScheduledMessage = (thread?.scheduledMessageCount ?? 0) > 0

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
          markAsRead()
        }
      }
    },
    [handleThreadClick, threadId, markAsRead, isUnread, viewMode, toggleSelection, setActiveThread]
  )

  // --- Derived values ---
  const formattedDate = useMemo(() => {
    return thread?.lastMessageAt
      ? formatDistanceToNowStrict(new Date(thread.lastMessageAt), { addSuffix: false })
      : ''
  }, [thread?.lastMessageAt])

  const senderName = useMemo(
    () => senderParticipant?.name || senderParticipant?.identifier || 'Unknown',
    [senderParticipant]
  )

  const snippet = useMemo(() => {
    if (typeof window !== 'undefined' && latestMessage?.snippet) {
      return DOMPurify.sanitize(latestMessage.snippet, { USE_PROFILES: { html: true } })
    }
    return latestMessage?.snippet ?? ''
  }, [latestMessage?.snippet])

  const hasTags = (thread?.tagIds?.length ?? 0) > 0

  // --- Loading state ---
  if (isThreadLoading || !thread) {
    return <ThreadItemSkeleton />
  }

  return (
    <AnimatePresence initial={false}>
      {!matchesFilter ? null : (
        <motion.div
          key={threadId}
          className='flex flex-row items-stretch relative outline-none! dark:focus-visible:ring-0!'
          style={{ contain: 'layout style' }}
          initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
          animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
          exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}>
          <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            id={`thread-${threadId}`}
            className={cn(
              'z-2 hover:bg-accent hover:text-accent-foreground dark:border-[#1e2227] group relative flex w-full cursor-grab flex-col items-start gap-1 rounded-lg border bg-background ps-6 pe-2 py-3 text-left text-sm active:cursor-grabbing dark:bg-[#2c313c] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:focus-visible:ring-0 dark:focus-visible:ring-offset-0',
              isMultiSelected &&
                'bg-info hover:bg-info-100! text-background shadow-md dark:bg-info dark:hover:bg-info-100 border-info/50'
            )}
            aria-selected={isMultiSelected}
            onClick={handleClick}
            onDragStart={(e) => e.preventDefault()}>
            {/* Status indicator dot: red for draft, amber clock for scheduled, blue for unread */}
            {(hasDraft || hasScheduledMessage || isUnread) &&
              (hasScheduledMessage && !hasDraft ? (
                <div
                  className={cn(
                    'absolute left-1.5 top-8 text-amber-500',
                    isMultiSelected && 'text-white'
                  )}
                  aria-label='Has scheduled message'>
                  <Clock className='size-3' />
                </div>
              ) : (
                <div
                  className={cn(
                    'absolute left-2 top-9 h-2 w-2 -translate-y-1/2 rounded-full',
                    hasDraft ? 'bg-red-500' : 'bg-blue-500',
                    isMultiSelected && 'bg-white'
                  )}
                  aria-label={hasDraft ? 'Has draft' : 'Unread message'}
                />
              ))}

            <div className='absolute top-3 left-1'>
              {viewMode === 'edit' ? (
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    if (e.shiftKey && selectionAnchorId) {
                      selectRange(selectionAnchorId, threadId, threadIds)
                    } else {
                      toggleSelection(threadId)
                    }
                    setSelectionAnchor(threadId)
                  }}>
                  <Checkbox checked={isMultiSelected} />
                </div>
              ) : (
                <div className='flex-none rounded-full border p-0.5 text-blue-500 group-aria-selected:bg-background group-aria-selected:border-info/90'>
                  {getIntegrationIcon(thread.integrationProvider)}
                </div>
              )}
            </div>

            {/* Content */}
            <div className='flex w-full flex-col gap-1'>
              <div className='flex items-center'>
                <div className='flex items-center ms-0.5 gap-0.5 overflow-hidden'>
                  <div className='flex-1 truncate font-semibold group-aria-selected:text-white'>
                    {senderName}
                  </div>
                </div>
                <div className='ml-auto shrink-0 whitespace-nowrap pl-2 text-xs text-muted-foreground group-aria-selected:text-background/50'>
                  {formattedDate}
                </div>
              </div>

              {/* Subject */}
              <div className='flex w-full items-center gap-1 min-w-0'>
                <div
                  className={cn(
                    'min-w-0 truncate text-xs font-medium group-aria-selected:text-background/80',
                    hasTags && 'max-w-[60%] shrink-0'
                  )}>
                  {thread.subject || '(no subject)'}
                </div>
                <div className='min-w-0 flex-1'>
                  <OverflowRow collapseSlot='text' className='justify-end' gap={4}>
                    {thread.tagIds?.map((tagId) => (
                      <TagBadge
                        key={tagId}
                        recordId={tagId}
                        size='sm'
                        className={cn(
                          isMultiSelected &&
                            'text-background/80 border-black/20 bg-background/50 border-black/3 dark:bg-background/50 dark:border-black/10 dark:text-foreground/80'
                        )}
                      />
                    ))}
                  </OverflowRow>
                </div>
              </div>
            </div>

            <div
              className='line-clamp-2 w-full break-words text-xs text-muted-foreground group-aria-selected:text-background/50'
              dangerouslySetInnerHTML={{ __html: snippet }}
            />
          </div>

          {/* Processing menu */}
          <div className='z-1 me-0.5 relative border-primary-500 rounded-r-lg -ms-1.5 ps-2 py-0.5 pe-0.5 bg-primary-200 dark:bg-[#252931] flex flex-row shrink-0'>
            <div
              className='absolute inset-0 rounded-r-lg pointer-events-none mask-y-from-98% mask-y-to-100%'
              style={{ boxShadow: 'inset 25px 0 25px -25px #000, 1px 1px 3px rgba(0,0,0,0.2)' }}
            />
            <div className='flex flex-col justify-start h-full'>
              <ProcessingMenu
                threadId={threadId}
                integrationId={thread?.integrationId}
                senderEmail={
                  senderParticipant?.identifierType === 'EMAIL'
                    ? senderParticipant.identifier
                    : undefined
                }
                update={update}
                isUpdating={isUpdating}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

/** Skeleton for loading thread item */
function ThreadItemSkeleton() {
  return (
    <div className='flex flex-row items-stretch relative'>
      <div className='z-2 group relative flex w-full flex-col items-start gap-1 rounded-lg border bg-background ps-6 pe-2 py-3'>
        <div className='flex w-full flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <Skeleton className='h-4 w-1/3' />
            <Skeleton className='h-3 w-16' />
          </div>
          <Skeleton className='h-3 w-2/3' />
          <Skeleton className='h-3 w-full' />
        </div>
      </div>
    </div>
  )
}
