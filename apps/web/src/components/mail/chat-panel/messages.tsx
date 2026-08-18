// apps/web/src/components/mail/chat-panel/messages.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useRef } from 'react'
import { useMessages, useThreadMutation } from '~/components/threads/hooks'
import CallDisplay from '../call-display'
import { ChatMessageGroup } from '../chat-message-group'
import { buildChatTimeline } from '../chat-timeline'
import type { EmailActions } from '../email-actions'
import EmailDisplay from '../email-display'
import MessageDisplay from '../message-display'
import { DaySeparator, EventBlock, useCollapsedDays } from './system-line-run'
import { useChatThreadEvents } from './use-thread-events'

interface ChatPanelMessagesProps {
  threadId: string
  /** Class forwarded to per-message dropdown content — used to bump z-index above floating compose. */
  popoverClassName?: string
}

/**
 * Scrollable message log for the floating chat panel. Subscribes to the same
 * store as the main thread view (no second fetch) and auto-scrolls to the
 * bottom as new messages arrive.
 */
export function ChatPanelMessages({ threadId, popoverClassName }: ChatPanelMessagesProps) {
  const { messages, isLoading } = useMessages({ threadId })
  const { events } = useChatThreadEvents({ threadId, enabled: true })
  const { update: updateThread } = useThreadMutation()
  const collapsedDays = useCollapsedDays(threadId)
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

  // Tracks which day the map iteration is inside — set by each separator item,
  // read by the items after it. Reset per render, mutated in render order.
  let currentDayKey: string | null = null

  return (
    <ScrollArea
      viewportRef={scrollRef}
      className='flex-1 **:data-[slot=scroll-area-viewport]:overscroll-none'
      scrollbarClassName='w-1!'>
      <div className='flex flex-col gap-2 px-3 py-2 pe-4'>
        {items.map((item) => {
          if (item.kind === 'day-separator') {
            currentDayKey = item.key
            return (
              <DaySeparator
                key={item.key}
                label={item.label}
                collapsed={collapsedDays.isCollapsed(item.key)}
                onToggle={() => collapsedDays.toggle(item.key)}
              />
            )
          }
          if (currentDayKey && collapsedDays.isCollapsed(currentDayKey)) return null
          if (item.kind === 'event-block') {
            return <EventBlock key={item.key} entries={item.entries} isTrailing={item.isTrailing} />
          }
          if (item.kind === 'chat-group') {
            const groupIsLast = item.endIndex === messages.length - 1
            return (
              <ChatMessageGroup
                key={`chat-group:${item.messages[0]!.id}`}
                messages={item.messages}
                messageActions={messageActions}
                isLast={groupIsLast}
                popoverClassName={popoverClassName}
              />
            )
          }
          // Non-chat messages are unexpected in a chat thread (the floating
          // panel only mounts for `provider === 'chat'` threads), but
          // `buildChatTimeline` is shared with `thread-messages.tsx` and a
          // mixed-transport thread (e.g. openphone SMS + CALL) is possible in
          // principle — give the "single" branch the same type switch instead
          // of a generic text fallback.
          const isLastMessage = item.index === messages.length - 1
          if (item.message.messageType === 'EMAIL') {
            return (
              <EmailDisplay
                key={item.message.id}
                messageId={item.message.id}
                messageActions={messageActions}
                isOpen={isLastMessage}
                isLastMessage={isLastMessage}
              />
            )
          }
          if (item.message.messageType === 'CALL' || item.message.messageType === 'VOICEMAIL') {
            return (
              <CallDisplay
                key={item.message.id}
                messageId={item.message.id}
                messageActions={messageActions}
                isOpen={isLastMessage}
              />
            )
          }
          return (
            <MessageDisplay
              key={item.message.id}
              messageId={item.message.id}
              messageActions={messageActions}
              isOpen={isLastMessage}
            />
          )
        })}
      </div>
    </ScrollArea>
  )
}
