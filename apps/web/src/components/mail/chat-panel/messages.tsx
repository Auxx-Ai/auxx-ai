// apps/web/src/components/mail/chat-panel/messages.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useRef } from 'react'
import { useMessages, useThreadMutation } from '~/components/threads/hooks'
import type { MessageMeta } from '~/components/threads/store'
import { ChatMessageGroup } from '../chat-message-group'
import type { EmailActions } from '../email-actions'

const CHAT_GROUP_WINDOW_MS = 5 * 60_000

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

  // Auto-scroll to bottom on new messages
  const latestMessageId = messages[messages.length - 1]?.id
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [latestMessageId])

  if (isLoading && messages.length === 0) {
    return (
      <div className='flex-1 space-y-3 overflow-hidden p-3'>
        <Skeleton className='h-10 w-2/3' />
        <Skeleton className='ml-auto h-10 w-1/2' />
        <Skeleton className='h-10 w-3/5' />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground'>
        No messages yet.
      </div>
    )
  }

  const items = buildRenderItems(messages)

  return (
    <ScrollArea viewportRef={scrollRef} className='flex-1' scrollbarClassName='w-1!'>
      <div className='flex flex-col gap-2 px-3 py-2'>
        {items.map((item) => {
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

type RenderItem =
  | { kind: 'single'; message: MessageMeta; index: number }
  | { kind: 'chat-group'; messages: MessageMeta[]; startIndex: number; endIndex: number }

function buildRenderItems(messages: MessageMeta[]): RenderItem[] {
  const items: RenderItem[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (m.messageType !== 'CHAT') {
      items.push({ kind: 'single', message: m, index: i })
      continue
    }
    const startIndex = i
    const run: MessageMeta[] = [m]
    while (i + 1 < messages.length && canGroupChat(run[run.length - 1]!, messages[i + 1]!)) {
      i++
      run.push(messages[i]!)
    }
    items.push({ kind: 'chat-group', messages: run, startIndex, endIndex: i })
  }
  return items
}

function canGroupChat(a: MessageMeta, b: MessageMeta): boolean {
  if (b.messageType !== 'CHAT') return false
  if (a.isInbound !== b.isInbound) return false
  if (fromParticipant(a) !== fromParticipant(b)) return false
  const aT = a.sentAt ? new Date(a.sentAt).getTime() : null
  const bT = b.sentAt ? new Date(b.sentAt).getTime() : null
  if (aT === null || bT === null) return true
  return Math.abs(bT - aT) <= CHAT_GROUP_WINDOW_MS
}

function fromParticipant(m: MessageMeta): string | null {
  return m.participants.find((p) => p.startsWith('from:')) ?? null
}
