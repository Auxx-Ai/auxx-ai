// apps/web/src/components/mail/mail-thread-item.tsx
'use client'

import { SendStatus } from '@auxx/database/enums'
import { evaluateConditions, normalizeStatusConditions } from '@auxx/lib/conditions/client'
import type { ActorId } from '@auxx/types/actor'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/types/resource'
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
import {
  Archive,
  Ban,
  Clock,
  MailWarning,
  Merge,
  MoreHorizontal,
  Share2,
  Trash2,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useSession } from '~/auth/auth-client'
import { AiGeneratingIndicatorCss } from '~/components/fields/ai-overlay/ai-generating-indicator-css'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import { RecordPickerContent } from '~/components/pickers/record-picker/record-picker-content'
import { TagBadge } from '~/components/tags/ui/tag-badge'
// NEW: Import from new hooks
import {
  useMessage,
  useMessageParticipants,
  useThread,
  useThreadReadStatus,
} from '~/components/threads/hooks'
import { useThreadActions } from '~/components/threads/providers'
import {
  useIsThreadActive,
  useIsThreadSelected,
  useSelectionAnchorId,
  useThreadSelectionStore,
} from '~/components/threads/store'
import { threadFieldResolver } from '~/components/threads/utils/thread-field-resolver'
import { useIsRecordProcessing } from '~/components/workflow/use-is-record-processing'
import { WorkflowSubMenu } from '~/components/workflow/workflow-submenu'
import { api } from '~/trpc/react'
import { AssigneeChip } from './assignee-chip'
import { useRetrySend } from './hooks'
import { useMailFilter } from './mail-filter-context'
import { getIntegrationIcon } from './mail-status-config'
import { SendStatusIndicator } from './send-status-indicator'

/**
 * Processing menu component for triggering manual message processing
 */
export function ProcessingMenu({
  threadId,
  integrationId,
  senderEmail,
  onOpenChange,
}: {
  threadId: string
  integrationId?: string
  senderEmail?: string
  onOpenChange?: (open: boolean) => void
}) {
  const onSuccess = useCallback(() => {
    console.log('Workflow triggered successfully')
  }, [])

  // Shared, hoisted thread actions (one instance app-wide) — see ThreadActionsProvider.
  const { update, merge } = useThreadActions()

  const handleMergeInto = useCallback(
    (ids: RecordId[]) => {
      const picked = ids[0]
      if (!picked) return
      const targetId = getInstanceId(picked)
      if (targetId === threadId) return
      merge([threadId], targetId)
      onOpenChange?.(false)
    },
    [merge, threadId, onOpenChange]
  )

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
        <Button
          variant='ghost'
          size='icon-xs'
          className='rounded-[8px]! hover:bg-background/50 group-aria-selected:text-background/50'>
          <MoreHorizontal />
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Merge />
            Merge into…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='p-0 w-72'>
            <RecordPickerContent
              value={[]}
              onChange={handleMergeInto}
              multi={false}
              entityDefinitionId='thread'
              excludeIds={[toRecordId('thread', threadId)]}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => update(threadId, { status: 'ARCHIVED' })}>
          <Archive />
          Archive
          <DropdownMenuShortcut>D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => update(threadId, { status: 'TRASH' })}
          variant='destructive'>
          <Trash2 />
          Trash Thread
          <DropdownMenuShortcut>#</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => update(threadId, { status: 'SPAM' })}>
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
  // `selectedThreadIds` is only provided by embedded mini-lists (ticket/contact
  // tabs). In the main mailbox it's undefined and we fall back to the granular
  // thread-selection store so toggling one checkbox re-renders only that row.
  const { viewMode, filterConditions, selectedThreadIds: scopedSelectedIds } = useMailFilter()

  // --- NEW: Use ID-based hooks ---
  const { thread, isLoading: isThreadLoading, isDeleted } = useThread({ threadId })
  const { message: latestMessage } = useMessage({
    messageId: thread?.latestMessageId,
    enabled: !!thread?.latestMessageId,
  })
  // Below `full`, latestMessageId is redacted to null — fall back to the
  // thread-level envelope participants (metadata tier, present at every lens).
  const {
    from: senderParticipant,
    to: toParticipants,
    cc: ccParticipants,
  } = useMessageParticipants(latestMessage?.participants ?? thread?.participants ?? [])
  const { isUnread: readStatusUnread, markAsRead } = useThreadReadStatus(threadId)

  // Redacted rendering (mail-permissions): below `full` the row never looks
  // unread (isUnread is full-tier); at `metadata` the subject is absent.
  const myLens = thread?.myLens ?? 'read'
  // A row whose thread hasn't landed yet renders bold — a list-row concern
  // only, which is why the hook now hands back `undefined` instead of baking
  // this default in for the detail pane too (plan 44 §1.3).
  const isUnread = myLens === 'read' && (readStatusUnread ?? true)

  // --- Selection store actions ---
  const toggleSelection = useThreadSelectionStore((s) => s.toggleSelection)
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setSelectionAnchor)
  const selectRange = useThreadSelectionStore((s) => s.selectRange)
  const selectionAnchorId = useSelectionAnchorId()

  const { data: session } = useSession()
  const currentUserId = session?.user?.id

  // --- Client-side filtering for optimistic updates ---
  // Normalize virtual status values (assigned/unassigned/done) into DB-level conditions
  const normalizedConditions = useMemo(
    () => normalizeStatusConditions(filterConditions),
    [filterConditions]
  )

  // Evaluate if this thread matches the current filter conditions
  const matchesFilter = useMemo(() => {
    if (!thread) return true // Show loading state
    return evaluateConditions(thread, normalizedConditions, threadFieldResolver, {
      currentUserId,
    })
  }, [thread, normalizedConditions, currentUserId])

  // Draft status is now embedded in ThreadMeta
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

  // --- Selection state ---
  // isMultiSelected = user-driven checkbox selection (drives checkbox + drag payload).
  // isActive = the thread currently open in the detail pane.
  // isHighlighted = visual blue highlight: either currently open OR checkbox-selected.
  const globalIsSelected = useIsThreadSelected(threadId)
  const isMultiSelected = scopedSelectedIds
    ? scopedSelectedIds.includes(threadId)
    : globalIsSelected
  // `activeThreadId` is a single app-wide value set by the mailbox detail pane.
  // Embedded mini-lists (ticket/contact tabs) announce themselves via
  // scopedSelectedIds and drive their own highlight, so they must NOT inherit
  // the mailbox's open-thread highlight — otherwise a thread open in the mailbox
  // lights up in every embedded list that happens to render it.
  const globalIsActive = useIsThreadActive(threadId)
  const isActive = scopedSelectedIds ? false : globalIsActive
  const isHighlighted = isActive || isMultiSelected
  const isProcessing = useIsRecordProcessing(toRecordId('thread', threadId))

  // --- Drag and Drop Setup ---
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: threadId,
    data: {
      type: 'thread',
      threadId,
      get draggedThreadIds() {
        const selected = useThreadSelectionStore.getState().selectedThreadIds
        return selected.includes(threadId) ? selected : [threadId]
      },
    },
    disabled: !threadId,
  })

  // --- Click handler ---
  const setSelectedThreads = useThreadSelectionStore((s) => s.setSelectedThreads)
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
        // Split-mode plain click abandons any checkbox multi-selection that was
        // built up via cmd/shift-click. Modifier clicks keep their own selection
        // semantics inside handleThreadClick.
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
          const store = useThreadSelectionStore.getState()
          if (store.selectedThreadIds.length > 0) {
            setSelectedThreads([])
          }
        }
        handleThreadClick(threadId, event)

        // Mark as read if thread is currently unread
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
      setSelectedThreads,
      selectRange,
      setSelectionAnchor,
      selectionAnchorId,
    ]
  )

  // --- Derived values ---
  const formattedDate = useMemo(() => {
    return thread?.lastMessageAt
      ? formatDistanceToNowStrict(new Date(thread.lastMessageAt), { addSuffix: false })
      : ''
  }, [thread?.lastMessageAt])

  // Show the counterparty, not the owner: when the latest message's FROM is
  // internal (owner-sent thread), display the first external recipient instead.
  // Only the latest message is loaded here — no per-row messages fetch — so we
  // scan its FROM/TO/CC and keep FROM when the thread is internal-only.
  const displaySender = useMemo(() => {
    if (senderParticipant && !senderParticipant.isInternal) return senderParticipant
    const external = [senderParticipant, ...toParticipants, ...ccParticipants].find(
      (p) => p && !p.isInternal
    )
    return external ?? senderParticipant ?? null
  }, [senderParticipant, toParticipants, ccParticipants])
  const senderName = displaySender?.displayName ?? 'Unknown'

  const snippet = useMemo(() => {
    if (typeof window !== 'undefined' && latestMessage?.snippet) {
      return DOMPurify.sanitize(latestMessage.snippet, { USE_PROFILES: { html: true } })
    }
    return latestMessage?.snippet ?? ''
  }, [latestMessage?.snippet])

  const hasTags = (thread?.tagIds?.length ?? 0) > 0

  // "Live" emphasis on chat rows whose latest inbound message landed in the
  // last few minutes — surfaces as a small dot on the channel icon.
  const isChatThread = (thread?.integrationProvider as string | null) === 'chat'
  const isLiveChat = useMemo(() => {
    if (!isChatThread || !thread?.lastMessageAt) return false
    if (!latestMessage?.isInbound) return false
    const ts = new Date(thread.lastMessageAt).getTime()
    return Date.now() - ts < 5 * 60_000
  }, [isChatThread, thread?.lastMessageAt, latestMessage?.isInbound])

  // --- Tombstoned (optimistic delete) — render nothing ---
  if (isDeleted) {
    return null
  }

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
              isHighlighted &&
                'bg-info hover:bg-info-100! text-background shadow dark:bg-info dark:hover:bg-info-100 border-info/50'
            )}
            aria-selected={isHighlighted}
            onClick={handleClick}
            onDragStart={(e) => e.preventDefault()}>
            {/* Status indicator dot: warning for a failed send, red for draft, amber clock for scheduled, blue for unread */}
            {sendFailed ? (
              <div className='absolute left-1 top-8'>
                <SendStatusIndicator
                  variant='icon'
                  status={latestMessage?.sendStatus}
                  error={latestMessage?.providerError}
                  attempts={latestMessage?.attempts}
                  integrationId={thread.integrationId}
                  onRetry={retry}
                  isRetrying={isRetrying}
                  className='size-3.5'
                />
              </div>
            ) : (
              (hasDraft || hasScheduledMessage || isUnread) &&
              (hasScheduledMessage && !hasDraft ? (
                <div
                  className={cn(
                    'absolute left-1.5 top-8 text-amber-500',
                    isHighlighted && 'text-white'
                  )}
                  aria-label='Has scheduled message'>
                  <Clock className='size-3' />
                </div>
              ) : (
                <div
                  className={cn(
                    'absolute left-2 top-9 h-2 w-2 -translate-y-1/2 rounded-full',
                    hasDraft ? 'bg-red-500' : 'bg-blue-500',
                    isHighlighted && 'bg-white'
                  )}
                  aria-label={hasDraft ? 'Has draft' : 'Unread message'}
                />
              ))
            )}

            <div className={cn('absolute left-1', isProcessing ? 'top-1' : 'top-3')}>
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
              ) : isProcessing ? (
                <SparkleIcon variant='generating' className='shrink-0' />
              ) : (
                <div className='relative flex-none rounded-full border p-0.5 text-blue-500 group-aria-selected:bg-background group-aria-selected:border-info/90'>
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

            {/* Content */}
            <div className='flex w-full flex-col gap-1'>
              <div className='flex items-center'>
                <div className='flex items-center ms-0.5 gap-0.5 overflow-hidden'>
                  {isProcessing ? (
                    <>
                      <AiGeneratingIndicatorCss className='group-hover:hidden' />
                      <div className='hidden flex-1 truncate font-semibold group-hover:block group-aria-selected:text-white'>
                        {senderName}
                      </div>
                    </>
                  ) : (
                    <div className='flex-1 truncate font-semibold group-aria-selected:text-white'>
                      {senderName}
                    </div>
                  )}
                </div>
                <div className='ml-auto shrink-0 whitespace-nowrap pl-2 text-xs text-right min-w-[2.5rem] group/menu relative'>
                  <span className='text-muted-foreground group-aria-selected:text-background/50 group-hover:hidden group-has-data-[state=open]/menu:hidden'>
                    {formattedDate}
                  </span>
                  <div className='hidden absolute -right-1 -top-4 group-hover:flex group-has-data-[state=open]/menu:flex'>
                    <ProcessingMenu
                      threadId={threadId}
                      integrationId={thread?.integrationId}
                      senderEmail={
                        senderParticipant?.identifierType === 'EMAIL'
                          ? senderParticipant.identifier
                          : undefined
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Subject */}
              <div className='flex w-full items-center gap-1 min-w-0'>
                <div
                  className={cn(
                    'min-w-0 truncate text-xs font-medium group-aria-selected:text-background/80',
                    hasTags && 'max-w-[60%] shrink-0',
                    isLiveChat && 'font-semibold',
                    myLens === 'metadata' && 'font-normal text-muted-foreground italic'
                  )}>
                  {myLens === 'metadata'
                    ? 'No access to subject'
                    : thread.subject || '(no subject)'}
                </div>
                {thread.assigneeId && <AssigneeChip assigneeId={thread.assigneeId as ActorId} />}
                {thread.hasShares && (
                  <Share2 className='size-3 shrink-0 text-muted-foreground' aria-label='Shared' />
                )}
                <div className='min-w-0 flex-1'>
                  <OverflowRow collapseSlot='text' className='justify-end' gap={4}>
                    {thread.tagIds?.map((tagId) => (
                      <TagBadge
                        key={tagId}
                        recordId={tagId}
                        size='sm'
                        className={cn(
                          isHighlighted &&
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

          {/* Processing menu — mobile: bottom-right corner (desktop uses hover swap in header) */}
          <div className='sm:hidden absolute bottom-1.5 right-1.5 z-3'>
            <ProcessingMenu
              threadId={threadId}
              integrationId={thread?.integrationId}
              senderEmail={
                senderParticipant?.identifierType === 'EMAIL'
                  ? senderParticipant.identifier
                  : undefined
              }
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

/** Skeleton for loading thread item */
export function ThreadItemSkeleton() {
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
