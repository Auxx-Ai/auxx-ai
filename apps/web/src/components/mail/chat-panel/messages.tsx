// apps/web/src/components/mail/chat-panel/messages.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useRef } from 'react'
import { useMessages, useThreadMutation } from '~/components/threads/hooks'
import { ChatMessageGroup } from '../chat-message-group'
import { buildChatTimeline } from '../chat-timeline'
import type { EmailActions } from '../email-actions'
import { SystemLine } from './system-line'
import { useChatThreadEvents } from './use-thread-events'

interface ChatPanelMessagesProps {
  threadId: string
}

/**
 * Scrollable message log for the floating chat panel. Subscribes to the same
 * store as the main thread view (no second fetch) and auto-scrolls to the
 * bottom as new messages arrive.
 */
export function ChatPanelMessages({ threadId }: ChatPanelMessagesProps) {
  const { messages, isLoading } = useMessages({ threadId })
  const { events } = useChatThreadEvents({ threadId, enabled: true })
  const { update: updateThread } = useThreadMutation()
  const scrollRef = useRef<HTMLDivElement>(null)

  const messageActions = useMemo<EmailActions>(
    () => ({
      onReply: () => {},
      onReplyAll: () => {},
      onForward: () => {},
      onResend: () => {},
      onDelete: () => {
        updateThread(threadId, { status: 'TRASH' })
      },
      onDownload: () => {},
      onPrint: () => {},
      onCopyId: async (message) => {
        try {
          await navigator.clipboard.writeText(message.id)
          toastSuccess({ title: 'Message ID copied', description: message.id })
        } catch {
          toastError({ title: 'Failed to copy', description: 'Could not copy to clipboard' })
        }
      },
      onViewSource: () => {},
    }),
    [threadId, updateThread]
  )

  // Auto-scroll to bottom on new messages or thread events
  const latestMessageId = messages[messages.length - 1]?.id
  const latestEventId = events[events.length - 1]?.id
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [latestMessageId, latestEventId])

  if (isLoading && messages.length === 0) {
    return (
      <div className='flex-1 space-y-3 overflow-hidden p-3'>
        <Skeleton className='h-10 w-2/3' />
        <Skeleton className='ml-auto h-10 w-1/2' />
        <Skeleton className='h-10 w-3/5' />
      </div>
    )
  }

  if (messages.length === 0 && events.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground'>
        No messages yet.
      </div>
    )
  }

  const items = buildChatTimeline(messages, events)

  return (
    <ScrollArea viewportRef={scrollRef} className='flex-1' scrollbarClassName='w-1!'>
      <div className='flex flex-col gap-2 px-3 py-2'>
        {items.map((item) => {
          if (item.kind === 'event') {
            return <SystemLine key={`evt:${item.event.id}`} event={item.event} />
          }
          if (item.kind === 'chat-group') {
            const groupIsLast = item.endIndex === messages.length - 1
            return (
              <ChatMessageGroup
                key={`chat-group:${item.messages[0]!.id}`}
                messages={item.messages}
                messageActions={messageActions}
                isLast={groupIsLast}
              />
            )
          }
          // Non-chat messages are unexpected in a chat thread; render a
          // compact text fallback so we still surface them.
          return (
            <div
              key={item.message.id}
              className='mx-auto w-full max-w-2xl rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground'>
              {item.message.snippet || item.message.textPlain || '(non-chat message)'}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
