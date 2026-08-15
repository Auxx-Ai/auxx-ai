// apps/web/src/components/mail/compact-thread-item.tsx
'use client'

import { SendStatus } from '@auxx/database/enums'
import { evaluateConditions, normalizeStatusConditions } from '@auxx/lib/conditions/client'
import type { ActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import DOMPurify from 'dompurify'
import { Archive, ChevronRight, Clock, Share2, ShieldAlert, Tag, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useSession } from '~/auth/auth-client'
import { AiGeneratingIndicatorCss } from '~/components/fields/ai-overlay/ai-generating-indicator-css'
import { Tooltip } from '~/components/global/tooltip'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import { TagBadge } from '~/components/tags/ui/tag-badge'
import {
  useMessage,
  useMessageParticipants,
  useThread,
  useThreadReadStatus,
  useThreadTitle,
} from '~/components/threads/hooks'
import { useThreadActions } from '~/components/threads/providers'
import {
  useHasSelection,
  useIsThreadSelected,
  useSelectionAnchorId,
  useThreadSelectionStore,
} from '~/components/threads/store'
import { threadFieldResolver } from '~/components/threads/utils/thread-field-resolver'
import { useIsRecordProcessing } from '~/components/workflow/use-is-record-processing'
import { AssigneeChip } from './assignee-chip'
import { useRetrySend } from './hooks'
import { useMailFilter } from './mail-filter-context'
import { getIntegrationIcon } from './mail-status-config'
import { ProcessingMenu } from './mail-thread-item'
import { SendStatusIndicator } from './send-status-indicator'

export interface CompactThreadItemProps {
  threadId: string
  basePath: string
  isSelected: boolean
  handleThreadClick: (threadId: string, event: React.MouseEvent) => void
  /** All thread IDs in display order, needed for shift+click range selection */
  threadIds: string[]
  /** Called when a tag badge is clicked, to open the tag picker for this thread */
  onTagClick?: (threadId: string) => void
  /** Called when the assign action is clicked, to open the assign picker for this thread */
  onAssignClick?: (threadId: string) => void
}

export const CompactThreadItem = memo(function CompactThreadItem({
  threadId,
  basePath: _basePath,
  isSelected: _isSelected,
  handleThreadClick,
  threadIds,
  onTagClick,
  onAssignClick,
}: CompactThreadItemProps) {
  const { viewMode, filterConditions } = useMailFilter()
  const { thread, isLoading: isThreadLoading, isDeleted } = useThread({ threadId })
  const { message: latestMessage } = useMessage({
    messageId: thread?.latestMessageId,
    enabled: !!thread?.latestMessageId,
  })
  // Below `full`, latestMessageId is redacted to null — fall back to the
  // thread-level envelope participants (metadata tier, present at every lens).
  const { from: senderParticipant } = useMessageParticipants(
    latestMessage?.participants ?? thread?.participants ?? []
  )
  const { isUnread: readStatusUnread, markAsRead } = useThreadReadStatus(threadId)

  // Redacted rendering (mail-permissions): below `full` the row never looks
  // unread (isUnread is full-tier); at `metadata` the subject is absent.
  const myLens = thread?.myLens ?? 'read'
  // Not-yet-loaded rows render bold; see the note in `mail-thread-item`.
  const isUnread = myLens === 'read' && (readStatusUnread ?? true)

  const toggleSelection = useThreadSelectionStore((s) => s.toggleSelection)
  const setActiveThread = useThreadSelectionStore((s) => s.setActiveThread)
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setSelectionAnchor)
  const selectRange = useThreadSelectionStore((s) => s.selectRange)
  const setFocusedThread = useThreadSelectionStore((s) => s.setFocusedThread)
  const selectionAnchorId = useSelectionAnchorId()
  const { update } = useThreadActions()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id

  const normalizedConditions = useMemo(
    () => normalizeStatusConditions(filterConditions),
    [filterConditions]
  )

  const matchesFilter = useMemo(() => {
    if (!thread) return true
    return evaluateConditions(thread, normalizedConditions, threadFieldResolver, {
      currentUserId,
    })
  }, [thread, normalizedConditions, currentUserId])

  const hasDraft = (thread?.draftIds?.length ?? 0) > 0
  const hasScheduledMessage = (thread?.scheduledMessageCount ?? 0) > 0

  // A failed outbound send outranks every other dot in the status slot — it's
  // the only one that needs the agent to do something. `latestMessage` is
  // already in the store for the snippet, so this costs no extra fetch.
  const sendFailed =
    latestMessage?.isInbound === false &&
    (latestMessage.sendStatus === SendStatus.FAILED ||
      latestMessage.sendStatus === SendStatus.BOUNCED)
  const { retry, isRetrying } = useRetrySend(
    sendFailed ? latestMessage?.id : undefined,
    thread?.integrationId
  )

  const isMultiSelected = useIsThreadSelected(threadId)

  const isFocused = useThreadSelectionStore((s) => s.focusedThreadId === threadId)
  const isProcessing = useIsRecordProcessing(toRecordId('thread', threadId))

  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const hasAnySelected = useHasSelection()
  const showCheckbox = viewMode === 'edit' || isFocused || hasAnySelected

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.detail > 1) event.preventDefault()

      if (viewMode === 'edit') {
        event.preventDefault()
        if (event.shiftKey && selectionAnchorId) {
          selectRange(selectionAnchorId, threadId, threadIds)
        } else {
          toggleSelection(threadId)
        }
        setSelectionAnchor(threadId)
      } else {
        handleThreadClick(threadId, event)
        if (isUnread) {
          markAsRead()
        }
      }
    },
    [
      handleThreadClick,
      threadId,
      threadIds,
      markAsRead,
      isUnread,
      viewMode,
      toggleSelection,
      selectRange,
      setSelectionAnchor,
      selectionAnchorId,
    ]
  )

  const formattedDate = useMemo(() => {
    return thread?.lastMessageAt
      ? formatDistanceToNowStrict(new Date(thread.lastMessageAt), { addSuffix: false })
      : ''
  }, [thread?.lastMessageAt])

  const senderName = senderParticipant?.displayName ?? null

  // On subject-less channels (SMS/WhatsApp/DMs) the title slot falls back to
  // the thread's participant; `null` means "render the usual placeholder".
  const threadTitle = useThreadTitle(threadId)

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

  const isChatThread = (thread?.integrationProvider as string | null) === 'chat'
  const isLiveChat = useMemo(() => {
    if (!isChatThread || !thread?.lastMessageAt) return false
    if (!latestMessage?.isInbound) return false
    const ts = new Date(thread.lastMessageAt).getTime()
    return Date.now() - ts < 5 * 60_000
  }, [isChatThread, thread?.lastMessageAt, latestMessage?.isInbound])

  if (isDeleted) {
    return null
  }

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
            setFocusedThread(threadId)
          }}>
          <div
            id={`thread-${threadId}`}
            className={cn(
              'group flex h-9 w-full cursor-pointer items-center border-b border-primary-200 pe-3 text-sm transition-colors hover:bg-accent/50',
              isMultiSelected &&
                'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
              isFocused &&
                !isMultiSelected &&
                'bg-primary-200/80 hover:bg-primary-200 dark:bg-primary-400/30'
            )}
            aria-selected={isMultiSelected}
            onMouseDown={(e) => {
              if (e.shiftKey) e.preventDefault()
            }}
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
                {sendFailed ? (
                  <SendStatusIndicator
                    variant='icon'
                    status={latestMessage?.sendStatus}
                    error={latestMessage?.providerError}
                    attempts={latestMessage?.attempts}
                    integrationId={thread.integrationId}
                    onRetry={retry}
                    isRetrying={isRetrying}
                    className='size-3'
                  />
                ) : hasScheduledMessage && !hasDraft ? (
                  <Clock className='size-2.5 text-amber-500' />
                ) : hasDraft ? (
                  <div className='size-2 rounded-full bg-red-500' />
                ) : isUnread ? (
                  <Tooltip content='Mark as read' shortcut='U'>
                    <div className='size-2 rounded-full bg-blue-500' />
                  </Tooltip>
                ) : null}
              </div>
            </div>

            {/* Integration icon */}
            <div className='flex w-5 shrink-0 items-center justify-center ms-0.5'>
              {isProcessing ? (
                <SparkleIcon variant='generating' className='shrink-0' />
              ) : (
                <div className='relative rounded-full border p-0.5 text-blue-500'>
                  {getIntegrationIcon(thread.integrationProvider)}
                  {isLiveChat && (
                    <span
                      className='absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500 ring-2 ring-background animate-pulse'
                      aria-label='Live chat'
                    />
                  )}
                </div>
              )}
            </div>

            {/* Sender - fixed width */}
            <div
              className={cn(
                'w-[140px] shrink-0 truncate text-xs ms-2',
                isUnread ? 'text-foreground' : 'text-foreground/80'
              )}>
              {isProcessing ? (
                <>
                  <AiGeneratingIndicatorCss className='group-hover:hidden' />
                  <span className='hidden truncate group-hover:inline-flex'>
                    {senderName ?? <Skeleton className='h-3 w-24' />}
                  </span>
                </>
              ) : (
                (senderName ?? <Skeleton className='h-3 w-24' />)
              )}
            </div>

            {/* Assignee avatar — fixed slot to avoid layout shift, and the assign
                picker's anchor (see `assign-anchor-` lookup in mail-thread-list) */}
            <div
              id={`assign-anchor-${threadId}`}
              className='flex w-5 shrink-0 items-center justify-center ms-1.5'>
              <AssigneeChip
                assigneeId={thread.assigneeId as ActorId | null}
                onClick={() => onAssignClick?.(threadId)}
              />
            </div>

            {/* Tags */}
            {hasTags && (
              <div
                className='flex shrink-0 items-center gap-1 ms-2'
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick?.(threadId)
                }}>
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
                  isUnread ? 'text-foreground' : 'font-medium text-foreground/90',
                  hasTags ? 'max-w-[40%]' : 'max-w-[50%]',
                  isLiveChat && 'font-semibold',
                  myLens === 'metadata' && 'font-normal text-muted-foreground italic'
                )}>
                {myLens === 'metadata' ? 'No access to subject' : (threadTitle ?? '(no subject)')}
              </span>
              {thread.hasShares && (
                <Share2 className='size-3 shrink-0 text-muted-foreground' aria-label='Shared' />
              )}
              {snippet && (
                <>
                  <span className='shrink-0 text-muted-foreground/40'>
                    <ChevronRight className='size-3' />
                  </span>
                  <span className='min-w-0 truncate text-xs text-muted-foreground'>{snippet}</span>
                </>
              )}
            </div>

            {/* Time + Hover actions */}
            <div className='flex shrink-0 items-center justify-end gap-1 ms-2'>
              <div
                className={cn(
                  'items-center gap-0.5 hidden',
                  isFocused || isMenuOpen ? 'flex opacity-100' : 'opacity-0 pointer-events-none'
                )}
                onClick={(e) => e.stopPropagation()}>
                <Tooltip content='Done' shortcut='D' delayDuration={300}>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-6'
                    onClick={() => update(threadId, { status: 'ARCHIVED' })}>
                    <Archive className='size-3.5' />
                  </Button>
                </Tooltip>
                <Tooltip content='Trash' shortcut='#' delayDuration={300}>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-6'
                    onClick={() => update(threadId, { status: 'TRASH' })}>
                    <Trash2 className='size-3.5' />
                  </Button>
                </Tooltip>
                <Tooltip content='Spam' shortcut='!' delayDuration={300}>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-6'
                    onClick={() => update(threadId, { status: 'SPAM' })}>
                    <ShieldAlert className='size-3.5' />
                  </Button>
                </Tooltip>
                <Tooltip content='Tag' shortcut='T' delayDuration={300}>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-6'
                    onClick={() => onTagClick?.(threadId)}>
                    <Tag className='size-3.5' />
                  </Button>
                </Tooltip>
                <ProcessingMenu
                  threadId={threadId}
                  integrationId={thread?.integrationId}
                  senderEmail={
                    senderParticipant?.identifierType === 'EMAIL'
                      ? senderParticipant.identifier
                      : undefined
                  }
                  onOpenChange={setIsMenuOpen}
                />
              </div>
              <span className='text-xs text-muted-foreground w-16 text-right'>{formattedDate}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

export function CompactThreadItemSkeleton() {
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
