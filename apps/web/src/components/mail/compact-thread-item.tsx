// apps/web/src/components/mail/compact-thread-item.tsx
'use client'

import { evaluateConditions, normalizeStatusConditions } from '@auxx/lib/conditions/client'
import { toRecordId } from '@auxx/types/resource'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import DOMPurify from 'dompurify'
import { Clock } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import { TagBadge } from '~/components/tags/ui/tag-badge'
import {
  useMessage,
  useMessageParticipants,
  useThread,
  useThreadMutation,
  useThreadReadStatus,
} from '~/components/threads/hooks'
import { useSelectionAnchorId, useThreadSelectionStore } from '~/components/threads/store'
import { threadFieldResolver } from '~/components/threads/utils/thread-field-resolver'
import { useMailFilter } from './mail-filter-context'
import { getIntegrationIcon } from './mail-status-config'
import { ProcessingMenu } from './mail-thread-item'

export interface CompactThreadItemProps {
  threadId: string
  basePath: string
  isSelected: boolean
  handleThreadClick: (threadId: string, event: React.MouseEvent) => void
  /** All thread IDs in display order, needed for shift+click range selection */
  threadIds: string[]
}

export const CompactThreadItem = memo(function CompactThreadItem({
  threadId,
  basePath: _basePath,
  isSelected: _isSelected,
  handleThreadClick,
  threadIds,
}: CompactThreadItemProps) {
  const { selectedThreadIds, viewMode, filterConditions } = useMailFilter()
  const { thread, isLoading: isThreadLoading } = useThread({ threadId })
  const { message: latestMessage } = useMessage({
    messageId: thread?.latestMessageId,
    enabled: !!thread?.latestMessageId,
  })
  const { from: senderParticipant } = useMessageParticipants(latestMessage?.participants ?? [])
  const { isUnread, markAsRead } = useThreadReadStatus(threadId)

  const toggleSelection = useThreadSelectionStore((s) => s.toggleSelection)
  const setActiveThread = useThreadSelectionStore((s) => s.setActiveThread)
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setSelectionAnchor)
  const selectRange = useThreadSelectionStore((s) => s.selectRange)
  const setFocusedThread = useThreadSelectionStore((s) => s.setFocusedThread)
  const selectionAnchorId = useSelectionAnchorId()
  const { update, isUpdating } = useThreadMutation()

  const normalizedConditions = useMemo(
    () => normalizeStatusConditions(filterConditions),
    [filterConditions]
  )

  const matchesFilter = useMemo(() => {
    if (!thread) return true
    return evaluateConditions(thread, normalizedConditions, threadFieldResolver)
  }, [thread, normalizedConditions])

  const hasDraft = (thread?.draftIds?.length ?? 0) > 0
  const hasScheduledMessage = (thread?.scheduledMessageCount ?? 0) > 0

  const isMultiSelected = useMemo(
    () => selectedThreadIds.includes(threadId),
    [selectedThreadIds, threadId]
  )

  const isFocused = useThreadSelectionStore((s) => s.focusedThreadId === threadId)

  const [isHovered, setIsHovered] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const hasAnySelected = selectedThreadIds.length > 0
  const showCheckbox = viewMode === 'edit' || isHovered || hasAnySelected || isFocused

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.detail > 1) event.preventDefault()

      if (viewMode === 'edit') {
        event.preventDefault()
        toggleSelection(threadId)
        setActiveThread(threadId)
      } else {
        handleThreadClick(threadId, event)
        if (isUnread) {
          markAsRead()
        }
      }
    },
    [handleThreadClick, threadId, markAsRead, isUnread, viewMode, toggleSelection, setActiveThread]
  )

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
      return DOMPurify.sanitize(latestMessage.snippet, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
      })
    }
    return latestMessage?.snippet ?? ''
  }, [latestMessage?.snippet])

  const hasTags = (thread?.tagIds?.length ?? 0) > 0

  if (isThreadLoading || !thread) {
    return <CompactThreadItemSkeleton />
  }

  return (
    <AnimatePresence initial={false}>
      {!matchesFilter ? null : (
        <motion.div
          key={threadId}
          initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
          animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
          exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          onMouseEnter={() => {
            setIsHovered(true)
            setFocusedThread(threadId)
          }}
          onMouseLeave={() => {
            if (!isMenuOpen) setIsHovered(false)
          }}>
          <div
            id={`thread-${threadId}`}
            className={cn(
              'group flex h-9 w-full cursor-pointer items-center border-b border-primary-200 pe-3 text-sm transition-colors hover:bg-accent/50',
              isMultiSelected &&
                'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
              isFocused && !isMultiSelected && 'bg-primary-200/80 hover:bg-primary-200'
            )}
            aria-selected={isMultiSelected}
            onClick={handleClick}>
            {/* Checkbox + Status dot (shared click area) */}
            <div
              className='flex shrink-0 items-center justify-center ps-3 pe-2 h-9 cursor-pointer gap-2'
              onClick={(e) => {
                e.stopPropagation()
                if (e.shiftKey && selectionAnchorId) {
                  selectRange(selectionAnchorId, threadId, threadIds)
                } else {
                  toggleSelection(threadId)
                }
                setSelectionAnchor(threadId)
                setActiveThread(null)
              }}>
              <div className='flex w-3.5 shrink-0 items-center justify-center'>
                {showCheckbox ? (
                  <Checkbox checked={isMultiSelected} className='size-3.5 pointer-events-none' />
                ) : (
                  <div className='size-3.5' />
                )}
              </div>
              <div className='flex w-3 shrink-0 items-center justify-center'>
                {hasScheduledMessage && !hasDraft ? (
                  <Clock className='size-2.5 text-amber-500' />
                ) : hasDraft ? (
                  <div className='size-2 rounded-full bg-red-500' />
                ) : isUnread ? (
                  <div className='size-2 rounded-full bg-blue-500' />
                ) : null}
              </div>
            </div>

            {/* Integration icon */}
            <div className='flex w-5 shrink-0 items-center justify-center ms-0.5'>
              <div className='rounded-full border p-0.5 text-blue-500'>
                {getIntegrationIcon(thread.integrationProvider)}
              </div>
            </div>

            {/* Sender - fixed width */}
            <div
              className={cn(
                'w-[140px] shrink-0 truncate text-xs ms-2',
                isUnread ? 'font-semibold text-foreground' : 'text-foreground/80'
              )}>
              {senderName}
            </div>

            {/* Tags */}
            {hasTags && (
              <div className='flex shrink-0 items-center gap-1 ms-2'>
                {thread.tagIds?.slice(0, 2).map((tagId) => (
                  <TagBadge key={tagId} recordId={tagId} size='sm' />
                ))}
              </div>
            )}

            {/* Subject + Snippet */}
            <div className='flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden ms-2'>
              <span
                className={cn(
                  'shrink-0 truncate text-xs',
                  isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
                  hasTags ? 'max-w-[40%]' : 'max-w-[50%]'
                )}>
                {thread.subject || '(no subject)'}
              </span>
              {snippet && (
                <>
                  <span className='shrink-0 text-muted-foreground/50'>—</span>
                  <span className='min-w-0 truncate text-xs text-muted-foreground'>{snippet}</span>
                </>
              )}
            </div>

            {/* Time + Hover actions */}
            <div className='flex shrink-0 items-center justify-end gap-1 ms-2'>
              <div
                className={cn(
                  'flex items-center transition-opacity',
                  isHovered || isMenuOpen ? 'opacity-100' : 'opacity-0'
                )}
                onClick={(e) => e.stopPropagation()}>
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
                  onOpenChange={(open) => {
                    setIsMenuOpen(open)
                    if (!open) setIsHovered(false)
                  }}
                />
              </div>
              <span className='text-xs text-muted-foreground w-14 text-right'>{formattedDate}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

function CompactThreadItemSkeleton() {
  return (
    <div className='flex h-9 w-full items-center gap-2 border-b border-primary-200 px-3'>
      <div className='h-3 w-7 animate-pulse rounded bg-muted' />
      <div className='h-3 w-3' />
      <div className='h-4 w-5 animate-pulse rounded bg-muted' />
      <div className='h-3 w-[140px] animate-pulse rounded bg-muted' />
      <div className='h-3 flex-1 animate-pulse rounded bg-muted' />
      <div className='h-3 w-12 animate-pulse rounded bg-muted' />
    </div>
  )
}
