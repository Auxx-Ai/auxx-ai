// apps/web/src/components/mail/thread-handoff-control.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Bot, HandMetal, Loader2 } from 'lucide-react'
import { useCallback } from 'react'
import { useSession } from '~/auth/auth-client'
import { Tooltip } from '~/components/global/tooltip'
import { useActor } from '~/components/resources/hooks'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { useThread } from '~/components/threads/hooks'
import { useThreadStore } from '~/components/threads/store'
import { AvatarWithStatusIcon } from '~/components/users/avatar-with-status-icon'
import { PresenceDot } from '~/components/users/presence-dot'
import { useConfirm } from '~/hooks/use-confirm'
import { useOrgPresence } from '~/hooks/use-org-presence'
import { api } from '~/trpc/react'
import { useThreadContext } from './thread-provider'

/**
 * Header control for chat handoff state. Mirrors the visual language of
 * `ThreadTicketControl` / `TicketBadge` so it sits flush alongside them.
 *
 * Three states (one button, three visuals):
 *  - AI driving:      dotted-outline badge, Bot icon + "AI replying", click = take over
 *  - Teammate on it:  solid badge, assignee avatar + first name, click = take over (confirm)
 *  - I'm on it:       solid badge, HandMetal + "You're on", click = return to AI
 */
export function ThreadHandoffControl() {
  const { threadId } = useThreadContext()
  const { thread } = useThread({ threadId })
  const [confirm, ConfirmDialog] = useConfirm()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id ?? null

  const handoffState = thread?.handoffState ?? 'ai'
  const assigneeId: ActorId | null = thread?.assigneeId ?? null

  const assigneeUserId = assigneeId
    ? (() => {
        try {
          return parseActorId(assigneeId).id
        } catch {
          return null
        }
      })()
    : null
  const isAssignedToMe = !!currentUserId && assigneeUserId === currentUserId

  const { actor: assignee } = useActor({
    actorId: assigneeUserId ? toActorId('user', assigneeUserId) : null,
    enabled: !!assigneeUserId,
  })
  const assigneeName = assignee?.name || 'A teammate'
  const assigneeFirstName = assigneeName.split(' ')[0] ?? assigneeName

  const orgHasActiveChatQuery = api.chatDuty.orgHasActiveChat.useQuery()
  const onDutyQuery = api.chatDuty.listOnDuty.useQuery(undefined, {
    enabled: orgHasActiveChatQuery.data === true,
  })
  const onDutyCount = (onDutyQuery.data ?? []).length

  const { getState } = useOrgPresence()
  const assigneePresence = getState(assigneeUserId)

  const takeOver = api.thread.takeOver.useMutation()
  const returnToAi = api.thread.returnToAi.useMutation()
  const updateThreadOptimistic = useThreadStore((s) => s.updateThreadOptimistic)
  const confirmOptimistic = useThreadStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useThreadStore((s) => s.rollbackOptimistic)

  const handleTakeOver = useCallback(async () => {
    if (handoffState === 'human' && !isAssignedToMe && assigneeUserId) {
      const ok = await confirm({
        title: `Take over from ${assigneeName}?`,
        description: 'Their session will end and the chat will route to you.',
        confirmText: 'Take over',
        cancelText: 'Cancel',
        destructive: false,
      })
      if (!ok) return
    }
    if (!currentUserId) return
    const version = updateThreadOptimistic(threadId, {
      handoffState: 'human',
      assigneeId: toActorId('user', currentUserId),
    })
    try {
      await takeOver.mutateAsync({ threadId })
      confirmOptimistic(threadId, version)
    } catch (error) {
      rollbackOptimistic(threadId, version)
      toastError({
        title: 'Failed to take over',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [
    handoffState,
    isAssignedToMe,
    assigneeUserId,
    assigneeName,
    confirm,
    takeOver,
    currentUserId,
    threadId,
    updateThreadOptimistic,
    confirmOptimistic,
    rollbackOptimistic,
  ])

  const handleReturnToAi = useCallback(async () => {
    const version = updateThreadOptimistic(threadId, { handoffState: 'ai' })
    try {
      await returnToAi.mutateAsync({ threadId })
      confirmOptimistic(threadId, version)
    } catch (error) {
      rollbackOptimistic(threadId, version)
      toastError({
        title: 'Failed to return to AI',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [returnToAi, threadId, updateThreadOptimistic, confirmOptimistic, rollbackOptimistic])

  if (!thread) return null

  const isPending = takeOver.isPending || returnToAi.isPending

  // --- State 1: AI driving ---
  if (handoffState === 'ai') {
    const dutyCopy =
      orgHasActiveChatQuery.data && onDutyQuery.isFetched
        ? onDutyCount === 0
          ? 'No teammates on chat duty right now.'
          : `${onDutyCount} teammate${onDutyCount === 1 ? '' : 's'} on chat duty.`
        : null
    return (
      <>
        <ConfirmDialog />
        <Tooltip
          content={
            <span>
              Our AI is replying to this chat.{dutyCopy ? ` ${dutyCopy}` : ''}
              <br />
              Click to take over.
            </span>
          }>
          <button
            type='button'
            disabled={isPending}
            onClick={handleTakeOver}
            className={cn(
              recordBadgeVariants({ variant: 'default' }),
              'bg-transparent text-primary-500 ring-0 outline-1 outline-dotted outline-neutral-300 cursor-pointer hover:bg-neutral-100 dark:bg-transparent dark:text-primary-500 dark:outline-primary-300 dark:hover:bg-muted',
              isPending && 'opacity-60'
            )}>
            {isPending ? (
              <Loader2 className='size-3.5 animate-spin' />
            ) : (
              <Bot className='size-3.5' />
            )}
            <span data-slot='record-display' className='truncate'>
              AI replying
            </span>
          </button>
        </Tooltip>
      </>
    )
  }

  // --- State 3: I'm the active responder ---
  if (isAssignedToMe) {
    return (
      <>
        <ConfirmDialog />
        <Tooltip content='Return this chat to AI'>
          <button
            type='button'
            disabled={isPending}
            onClick={handleReturnToAi}
            className={cn(
              recordBadgeVariants({ variant: 'default' }),
              'cursor-pointer hover:bg-neutral-200 dark:hover:bg-muted/60',
              isPending && 'opacity-60'
            )}>
            {isPending ? (
              <Loader2 className='size-3.5 animate-spin' />
            ) : (
              <HandMetal className='size-3.5' />
            )}
            <span data-slot='record-display' className='truncate'>
              You're on
            </span>
          </button>
        </Tooltip>
      </>
    )
  }

  // --- State 2: Another teammate is on it ---
  const assigneeInitials =
    assigneeName
      .split(' ')
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .substring(0, 2) || '?'
  const presenceSuffix =
    assigneePresence === 'away' ? ' (away)' : assigneePresence === 'offline' ? ' (offline)' : ''
  return (
    <>
      <ConfirmDialog />
      <Tooltip content={`${assigneeName}${presenceSuffix} is on this chat. Click to take over.`}>
        <button
          type='button'
          disabled={isPending}
          onClick={handleTakeOver}
          className={cn(
            recordBadgeVariants({ variant: 'default' }),
            'cursor-pointer hover:bg-neutral-200 dark:hover:bg-muted/60',
            isPending && 'opacity-60'
          )}>
          {isPending ? (
            <Loader2 className='size-3.5 animate-spin' />
          ) : assignee ? (
            <span className='relative inline-flex'>
              <AvatarWithStatusIcon
                className='size-4'
                status='none'
                src={assignee?.image}
                alt={assigneeName}
                fallback={assigneeInitials}
              />
              <PresenceDot
                state={assigneePresence}
                hideOffline
                className='absolute -bottom-0.5 -left-0.5 size-1.5'
              />
            </span>
          ) : (
            <Skeleton className='size-4 rounded-full' />
          )}
          <span data-slot='record-display' className='truncate'>
            {assigneeFirstName}
          </span>
        </button>
      </Tooltip>
    </>
  )
}
