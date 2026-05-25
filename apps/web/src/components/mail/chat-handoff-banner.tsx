// apps/web/src/components/mail/chat-handoff-banner.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Bot, HandMetal } from 'lucide-react'
import { useCallback } from 'react'
import { useSession } from '~/auth/auth-client'
import { useActor } from '~/components/resources/hooks'
import { useThreadStore } from '~/components/threads/store'
import { AvatarWithStatusIcon } from '~/components/users/avatar-with-status-icon'
import { PresenceDot } from '~/components/users/presence-dot'
import { useConfirm } from '~/hooks/use-confirm'
import { useOrgPresence } from '~/hooks/use-org-presence'
import { api } from '~/trpc/react'

interface ChatHandoffBannerProps {
  threadId: string
  handoffState: 'ai' | 'human'
  assigneeId: ActorId | null
}

/**
 * Three-state banner shown on chat threads in the admin thread view.
 *
 * - `handoffState === 'ai'`         → "Our AI is replying to this chat." + Take over
 * - `handoffState === 'human'` & assignee !== me → "{name} is on this chat." + Take over (confirm)
 * - `handoffState === 'human'` & assignee === me → "You're on this chat." + Return to AI
 *
 * Composes presence dots / "N teammates on duty" copy in future phases
 * (4b-ii / 4c); degrades gracefully today without them.
 */
export function ChatHandoffBanner({ threadId, handoffState, assigneeId }: ChatHandoffBannerProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id ?? null

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

  // Chat-duty count for AI-banner copy ("N teammates on chat duty"). Gated
  // on org having an active chat channel so non-chat orgs don't pay the cost.
  const orgHasActiveChatQuery = api.chatDuty.orgHasActiveChat.useQuery()
  const onDutyQuery = api.chatDuty.listOnDuty.useQuery(undefined, {
    enabled: orgHasActiveChatQuery.data === true,
  })
  const onDutyUserIds = onDutyQuery.data ?? []
  const onDutyCount = onDutyUserIds.length
  const assigneeOnDuty = !!assigneeUserId && onDutyUserIds.includes(assigneeUserId)

  const { getState } = useOrgPresence()
  const assigneePresence = getState(assigneeUserId)

  const takeOver = api.thread.takeOver.useMutation()
  const returnToAi = api.thread.returnToAi.useMutation()
  const updateThreadOptimistic = useThreadStore((s) => s.updateThreadOptimistic)
  const confirmOptimistic = useThreadStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useThreadStore((s) => s.rollbackOptimistic)

  const handleTakeOver = useCallback(async () => {
    // When stealing from another teammate, confirm first so it isn't an
    // accidental click on a chat someone else is actively handling.
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
    // Server leaves `assigneeId` untouched (audit trail of last human), so we
    // only flip the handoff state here.
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

  // State 1 — AI is driving.
  if (handoffState === 'ai') {
    const showDutyCount = orgHasActiveChatQuery.data && onDutyQuery.isFetched
    return (
      <>
        <ConfirmDialog />
        <div className='mx-4 mt-2 flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm'>
          <div className='flex items-center gap-2 text-muted-foreground'>
            <Bot className='size-4 shrink-0' />
            <span>
              Our AI is replying to this chat.
              {showDutyCount && (
                <>
                  {' '}
                  {onDutyCount === 0
                    ? 'No teammates on chat duty right now.'
                    : `${onDutyCount} teammate${onDutyCount === 1 ? '' : 's'} on chat duty.`}
                </>
              )}
            </span>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={handleTakeOver}
            loading={takeOver.isPending}
            loadingText='Taking over...'>
            <HandMetal />
            Take over
          </Button>
        </div>
      </>
    )
  }

  // State 3 — I'm the active responder.
  if (isAssignedToMe) {
    return (
      <>
        <ConfirmDialog />
        <div className='mx-4 mt-2 flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm'>
          <div className='flex items-center gap-2 text-muted-foreground'>
            <span>You're on this chat.</span>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={handleReturnToAi}
            loading={returnToAi.isPending}
            loadingText='Returning...'>
            <Bot />
            Return to AI
          </Button>
        </div>
      </>
    )
  }

  // State 2 — another teammate is on it.
  const assigneeInitials =
    assigneeName
      .split(' ')
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .substring(0, 2) || '?'
  return (
    <>
      <ConfirmDialog />
      <div className='mx-4 mt-2 flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm'>
        <div className='flex items-center gap-2 text-muted-foreground'>
          <span className='relative inline-flex'>
            <AvatarWithStatusIcon
              className='size-5'
              status={assigneeOnDuty ? 'on_duty' : 'none'}
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
          <span>
            {assigneeName} is on this chat
            {assigneePresence === 'away'
              ? ' (away)'
              : assigneePresence === 'offline'
                ? ' (offline)'
                : ''}
            .
          </span>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={handleTakeOver}
          loading={takeOver.isPending}
          loadingText='Taking over...'>
          <HandMetal />
          Take over
        </Button>
      </div>
    </>
  )
}
