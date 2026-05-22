// apps/web/src/components/mail/chat-handoff-banner.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Bot, HandMetal } from 'lucide-react'
import { useCallback } from 'react'
import { useSession } from '~/auth/auth-client'
import { useActor } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
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

  const takeOver = api.thread.takeOver.useMutation()
  const returnToAi = api.thread.returnToAi.useMutation()
  const utils = api.useUtils()

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
    try {
      await takeOver.mutateAsync({ threadId })
      await utils.thread.invalidate()
    } catch (error) {
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
    utils,
    threadId,
  ])

  const handleReturnToAi = useCallback(async () => {
    try {
      await returnToAi.mutateAsync({ threadId })
      await utils.thread.invalidate()
    } catch (error) {
      toastError({
        title: 'Failed to return to AI',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [returnToAi, utils, threadId])

  // State 1 — AI is driving.
  if (handoffState === 'ai') {
    return (
      <>
        <ConfirmDialog />
        <div className='mx-4 mt-2 flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm'>
          <div className='flex items-center gap-2 text-muted-foreground'>
            <Bot className='size-4 shrink-0' />
            <span>Our AI is replying to this chat.</span>
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
  return (
    <>
      <ConfirmDialog />
      <div className='mx-4 mt-2 flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm'>
        <div className='flex items-center gap-2 text-muted-foreground'>
          <Avatar className='size-5'>
            <AvatarImage src={assignee?.image || undefined} alt={assigneeName} />
            <AvatarFallback className='text-[10px]'>
              {assigneeName
                .split(' ')
                .map((p) => p[0])
                .join('')
                .toUpperCase()
                .substring(0, 2) || '?'}
            </AvatarFallback>
          </Avatar>
          <span>{assigneeName} is on this chat.</span>
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
