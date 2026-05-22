// apps/chat-widget/src/views/conversation/conversation-view.tsx
//
// Body for the `thread` frame: loads history, subscribes to the per-session
// Pusher channel for live updates, renders grouped message bubbles, and hosts
// the composer at the bottom.

import { User } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { cn } from '~/lib/cn'
import { markThreadRead } from '~/persistence/unread'
import { type ChatMessage, chatApi } from '~/transport/chat-api'
import type { ChatConfig } from '~/transport/config'
import { connectPusher } from '~/transport/pusher'
import { Composer, type ComposerSendArgs } from './composer/composer'
import { SuggestedReplies } from './suggested-replies'

interface ConversationViewProps {
  channelId: string
  threadId: string
  config: ChatConfig
}

interface InitState {
  sessionId: string
  pusherChannel: string
}

export function ConversationView({ channelId, threadId, config }: ConversationViewProps) {
  const api = useMemo(() => chatApi(channelId), [channelId])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [init, setInit] = useState<InitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Bootstrap: call initialize so we always have a sessionId + pusherChannel
  // matched to the visitor's current passport. The endpoint resumes when a
  // thread already exists, so this is cheap on re-open.
  useEffect(() => {
    let cancelled = false
    api
      .initialize({
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        threadId,
      })
      .then((data) => {
        if (cancelled) return
        setInit({ sessionId: data.sessionId, pusherChannel: data.pusherChannel })
        if (data.threadId === threadId) {
          setMessages(data.messages)
        } else {
          // Fallback for cases where initialize resumed a different thread.
          api
            .getHistory(threadId, data.sessionId)
            .then((hist) => !cancelled && setMessages(hist.messages))
            .catch(() => {})
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load conversation')
      })
    return () => {
      cancelled = true
    }
  }, [api, threadId])

  // Subscribe to the per-session channel for live transcript updates.
  useEffect(() => {
    if (!init) return
    const conn = connectPusher({
      key: config.realtime.key,
      cluster: config.realtime.cluster,
      channelName: init.pusherChannel,
    })
    const handler = (data: {
      id: string
      threadId: string
      content: string
      sender: string
      createdAt: string
    }) => {
      if (data.threadId !== threadId) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev
        return [
          ...prev,
          {
            id: data.id,
            content: data.content,
            sender: (data.sender as ChatMessage['sender']) ?? 'AGENT',
            createdAt: data.createdAt,
          },
        ]
      })
    }
    conn.channel.bind('new-message', handler)
    return () => {
      try {
        conn.channel.unbind('new-message', handler)
      } catch {
        /* ignore */
      }
      conn.disconnect()
    }
  }, [init, threadId, config.realtime.key, config.realtime.cluster])

  // Mark read whenever the last message changes.
  useEffect(() => {
    if (messages.length === 0) return
    markThreadRead(channelId, threadId)
  }, [channelId, threadId, messages.length])

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const handleSend = useCallback(
    async ({ content, attachmentIds }: ComposerSendArgs) => {
      if (!init) return
      const clientMessageId = `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const optimistic: ChatMessage = {
        id: clientMessageId,
        content,
        sender: 'USER',
        createdAt: new Date().toISOString(),
        status: 'sending',
      }
      setMessages((prev) => [...prev, optimistic])
      try {
        await api.sendMessage({
          sessionId: init.sessionId,
          threadId,
          content,
          clientMessageId,
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        } as any)
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) => (m.id === clientMessageId ? { ...m, status: 'error' } : m))
        )
        setError(e instanceof Error ? e.message : 'Failed to send message')
      }
    },
    [api, init, threadId]
  )

  const grouped = useMemo(() => groupConsecutive(messages), [messages])

  return (
    <div className='flex min-h-0 flex-1 flex-col bg-muted'>
      <div ref={bodyRef} className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3'>
        {error ? (
          <div className='rounded bg-background p-2 text-center text-xs text-destructive'>
            {error}
          </div>
        ) : null}
        {grouped.map((group, gi) => (
          <Bubble key={`g-${gi}`} group={group} />
        ))}
      </div>
      {init && messages.length === 0 ? (
        <SuggestedReplies
          replies={config.suggestedReplies ?? []}
          onSelect={(text) => handleSend({ content: text, attachmentIds: [] })}
        />
      ) : null}
      <Composer channelId={channelId} onSend={handleSend} />
      {config.branding.footerEnabled ? (
        <div className='border-t border-border bg-background py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground'>
          Powered by Auxx
        </div>
      ) : null}
    </div>
  )
}

interface MessageGroup {
  sender: ChatMessage['sender']
  messages: ChatMessage[]
}

function groupConsecutive(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const m of messages) {
    const last = groups[groups.length - 1]
    if (last && last.sender === m.sender) {
      last.messages.push(m)
    } else {
      groups.push({ sender: m.sender, messages: [m] })
    }
  }
  return groups
}

function Bubble({ group }: { group: MessageGroup }) {
  const isUser = group.sender === 'USER'
  const isSystem = group.sender === 'SYSTEM'
  if (isSystem) {
    return (
      <div className='self-center text-center text-xs italic text-muted-foreground'>
        {group.messages.map((m) => m.content).join(' ')}
      </div>
    )
  }
  return (
    <div className={cn('flex items-end gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser ? (
        <div className='flex size-7 shrink-0 items-center justify-center self-end rounded-full bg-background text-muted-foreground'>
          <User className='size-3.5' aria-hidden='true' />
        </div>
      ) : null}
      <div
        className={cn('flex max-w-[80%] flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
        {group.messages.map((m, i) => (
          <div
            key={m.id}
            className={cn(
              'whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm',
              isUser
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-background text-foreground',
              i === 0 && (isUser ? 'rounded-tr-md' : 'rounded-tl-md'),
              i === group.messages.length - 1 && (isUser ? 'rounded-br-sm' : 'rounded-bl-sm')
            )}>
            {m.content}
          </div>
        ))}
      </div>
    </div>
  )
}
