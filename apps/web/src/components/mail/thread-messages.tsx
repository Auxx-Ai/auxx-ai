// apps/web/src/components/mail/thread-messages.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCallback, useMemo } from 'react'
import { useMessages, useThread } from '~/components/threads/hooks'
import { useThreadStore } from '~/components/threads/store'
import type { ScheduledMessageMeta } from '~/components/threads/store/thread-store'
import { getThreadStoreState } from '~/components/threads/store/thread-store'
import { useCompose } from '~/hooks/use-compose'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import EmailDisplay from './email-display'
import type { DraftMessageType } from './email-editor/types'
import MessageDisplay from './message-display'
import { ScheduledMessageCard } from './scheduled-message-card'
import { useThreadContext, useThreadEmailActions } from './thread-provider'

const EMPTY_SCHEDULED: ScheduledMessageMeta[] = []

/**
 * Display component for thread messages.
 * Fetches messages from store and renders them.
 */
export function ThreadMessages() {
  // Get thread context for threadId
  const { threadId } = useThreadContext()
  const { thread } = useThread({ threadId })
  const messageActions = useThreadEmailActions()
  const scheduledMessagesMap = useThreadStore((s) => s.scheduledMessages)
  const scheduledMessages = useMemo(() => {
    const result: ScheduledMessageMeta[] = []
    for (const msg of scheduledMessagesMap.values()) {
      if (msg.threadId === threadId && (msg.status === 'PENDING' || msg.status === 'PROCESSING')) {
        result.push(msg)
      }
    }
    return result.length > 0 ? result : EMPTY_SCHEDULED
  }, [scheduledMessagesMap, threadId])
  const [confirm, ConfirmDialog] = useConfirm()
  const { openDraft } = useCompose()

  const cancelMutation = api.thread.cancelScheduledMessage.useMutation({
    onSuccess: (_data, variables) => {
      getThreadStoreState().removeScheduledMessage(variables.scheduledMessageId)

      // Decrement thread's scheduledMessageCount
      const currentThread = getThreadStoreState().getThread(threadId)
      if (currentThread) {
        getThreadStoreState().updateThread(threadId, {
          scheduledMessageCount: Math.max(0, (currentThread.scheduledMessageCount ?? 0) - 1),
        })
      }

      // If draft was returned, re-add to thread's draftIds
      if (_data.draftId) {
        const t = getThreadStoreState().getThread(threadId)
        if (t) {
          getThreadStoreState().updateThread(threadId, {
            draftIds: [...t.draftIds, `draft:${_data.draftId}` as any],
          })
        }
      }
    },
  })

  const handleCancelScheduled = useCallback(
    async (scheduledMessageId: string) => {
      const confirmed = await confirm({
        title: 'Cancel scheduled message?',
        description: 'The message will not be sent. Your draft will be preserved.',
        confirmText: 'Cancel message',
        cancelText: 'Keep scheduled',
        destructive: true,
      })
      if (confirmed) {
        cancelMutation.mutate({ scheduledMessageId })
      }
    },
    [confirm, cancelMutation]
  )

  const handleEditScheduled = useCallback(
    async (scheduledMessageId: string) => {
      const scheduled = getThreadStoreState().scheduledMessages.get(scheduledMessageId)
      if (!scheduled?.draftId) return

      const draftId = scheduled.draftId
      await cancelMutation.mutateAsync({ scheduledMessageId })

      openDraft({
        id: draftId,
        threadId: scheduled.threadId,
        inReplyToMessageId: null,
        includePreviousMessage: false,
        subject: (scheduled.sendPayload as any)?.subject || '',
        textHtml: '',
        textPlain: '',
        signatureId: null,
        participants: [],
        attachments: [],
        metadata: {},
        createdAt: scheduled.createdAt,
        updatedAt: scheduled.createdAt,
      } satisfies DraftMessageType)
    },
    [cancelMutation, openDraft]
  )

  // Fetch messages from store
  const { messages, isLoading } = useMessages({
    threadId: thread?.id ?? null,
    enabled: !!thread,
  })

  if (!thread) return null

  // Loading state
  if (isLoading && messages.length === 0) {
    return (
      <div className='flex flex-col gap-4 px-4 py-2'>
        {[1, 2, 3].map((i) => (
          <MessageSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col'>
      <ConfirmDialog />
      <div className='flex flex-1 flex-col space-y-4'>
        {/* Email messages */}
        <div
          className={`flex flex-col gap-4 px-4 py-2 ${thread.status === 'TRASH' ? 'opacity-50' : ''}`}>
          {messages.map((message, index) => {
            // Check if this is the last message in the array
            const isLastMessage = index === messages.length - 1 && scheduledMessages.length === 0

            // Route to appropriate component based on message type
            const component = (() => {
              switch (message.messageType) {
                case 'EMAIL':
                  return (
                    <EmailDisplay
                      messageId={message.id}
                      messageActions={messageActions}
                      isOpen={isLastMessage}
                      isLastMessage={isLastMessage}
                    />
                  )
                default:
                  return (
                    <MessageDisplay
                      messageId={message.id}
                      messageActions={messageActions}
                      isOpen={isLastMessage}
                    />
                  )
              }
            })()

            return (
              <div
                key={message.id}
                className='animate-in fade-in-0 slide-in-from-bottom-1 duration-300'
                style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}>
                {component}
              </div>
            )
          })}

          {/* Scheduled messages — appended after real messages */}
          {scheduledMessages.map((scheduled) => (
            <div
              key={scheduled.id}
              className='animate-in fade-in-0 slide-in-from-bottom-1 duration-300'>
              <ScheduledMessageCard
                scheduledMessage={scheduled}
                onCancel={handleCancelScheduled}
                onEdit={handleEditScheduled}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Skeleton for loading message.
 */
function MessageSkeleton() {
  return (
    <div className='rounded-2xl border p-4 space-y-3'>
      <div className='flex items-center gap-3'>
        <Skeleton className='h-8 w-8 rounded-lg' />
        <div className='space-y-2 flex-1'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-3 w-48' />
        </div>
        <Skeleton className='h-6 w-16' />
      </div>
      <Skeleton className='h-20 w-full' />
    </div>
  )
}
