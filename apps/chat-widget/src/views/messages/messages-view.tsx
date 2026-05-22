// apps/chat-widget/src/views/messages/messages-view.tsx
//
// Messages tab root. Loads the visitor's threads, subscribes to the per-visitor
// channel to bump/insert rows on realtime events, and renders an infinite list.
// The floating "Send us a message" pill creates a fresh thread and pushes the
// conversation frame onto the Messages stack.

import { MessageCircle, Plus, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { cn } from '~/lib/cn'
import { useNavStack } from '~/navigation/nav-stack-context'
import { getLastReadAt } from '~/persistence/unread'
import { chatApi, type ThreadListItem } from '~/transport/chat-api'
import type { ThreadCreatedEvent, ThreadUpdatedEvent } from '~/transport/visitor-channel'

interface MessagesViewProps {
  channelId: string
  subscribe?: {
    onThreadUpdated: (cb: (e: ThreadUpdatedEvent) => void) => () => void
    onThreadCreated: (cb: (e: ThreadCreatedEvent) => void) => () => void
  }
}

export function MessagesView({ channelId, subscribe }: MessagesViewProps) {
  const nav = useNavStack()
  const api = chatApi(channelId)
  const [threads, setThreads] = useState<ThreadListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Initial load.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .listThreads(null)
      .then((data) => {
        if (cancelled) return
        setThreads(data.items)
        setNextCursor(data.nextCursor)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load conversations')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [channelId])

  // Pagination — load more when sentinel scrolls into view.
  useEffect(() => {
    if (!nextCursor) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading) {
          setLoading(true)
          api
            .listThreads(nextCursor)
            .then((data) => {
              setThreads((prev) => [...prev, ...data.items])
              setNextCursor(data.nextCursor)
            })
            .catch(() => {
              /* keep current list */
            })
            .finally(() => setLoading(false))
        }
      },
      { rootMargin: '120px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [nextCursor, loading, channelId])

  // Realtime updates: patch + bump on update, prepend on create.
  useEffect(() => {
    if (!subscribe) return
    const offUpdated = subscribe.onThreadUpdated((evt) => {
      setThreads((prev) => {
        const existing = prev.find((t) => t.id === evt.threadId)
        if (!existing) {
          // Unknown thread — refetch the first page so we pick it up with full
          // metadata. Cheaper than a single-thread lookup endpoint.
          api
            .listThreads(null)
            .then((data) => {
              setThreads(data.items)
              setNextCursor(data.nextCursor)
            })
            .catch(() => {})
          return prev
        }
        const updated: ThreadListItem = {
          ...existing,
          lastMessage: {
            snippet: evt.lastMessage.snippet,
            sentAt: evt.lastMessage.sentAt,
            isInbound: evt.lastMessage.sender === 'USER',
          },
          updatedAt: evt.lastMessage.sentAt,
        }
        return [updated, ...prev.filter((t) => t.id !== evt.threadId)]
      })
    })
    const offCreated = subscribe.onThreadCreated((evt) => {
      setThreads((prev) => {
        if (prev.some((t) => t.id === evt.threadId)) return prev
        const placeholder: ThreadListItem = {
          id: evt.threadId,
          agent: null,
          lastMessage: { snippet: '', sentAt: evt.createdAt, isInbound: false },
          unreadCount: 0,
          updatedAt: evt.createdAt,
        }
        return [placeholder, ...prev]
      })
    })
    return () => {
      offUpdated()
      offCreated()
    }
  }, [subscribe, channelId])

  const openThread = useCallback(
    (threadId: string, label: string) => {
      nav.push({ id: threadId, label, view: 'thread', params: { threadId } })
    },
    [nav]
  )

  const handleNewThread = useCallback(async () => {
    if (creating) return
    // Reuse the most recent existing thread if there is one — we only want
    // visitors to accumulate a single ongoing conversation, not a new thread
    // per click.
    if (threads.length > 0) {
      const top = threads[0]
      openThread(top.id, top.agent?.name ?? 'Conversation')
      return
    }
    setCreating(true)
    try {
      const { threadId } = await api.createThread({
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      })
      openThread(threadId, 'New conversation')
    } finally {
      setCreating(false)
    }
  }, [api, creating, openThread, threads])

  if (loading && threads.length === 0) {
    return (
      <Frame>
        <div className='flex flex-1 items-center justify-center text-xs text-[color:var(--color-muted)]'>
          Loading…
        </div>
      </Frame>
    )
  }

  if (error && threads.length === 0) {
    return (
      <Frame>
        <div className='flex flex-1 items-center justify-center px-6 text-center text-sm text-[color:var(--color-muted)]'>
          {error}
        </div>
      </Frame>
    )
  }

  if (threads.length === 0) {
    return (
      <Frame>
        <div className='flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center'>
          <div className='flex size-12 items-center justify-center rounded-full bg-[color:var(--color-surface)]'>
            <MessageCircle className='size-6 text-[color:var(--color-muted)]' aria-hidden='true' />
          </div>
          <div className='flex flex-col gap-1'>
            <p className='text-sm font-medium text-[color:var(--color-fg)]'>No conversations yet</p>
            <p className='text-xs text-[color:var(--color-muted)]'>
              Start one and we&apos;ll get back to you soon.
            </p>
          </div>
        </div>
        <FloatingSendPill onClick={handleNewThread} disabled={creating} />
      </Frame>
    )
  }

  return (
    <Frame>
      <div className='flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2'>
        {threads.map((t) => {
          const lastReadAt = getLastReadAt(channelId, t.id)
          const isUnread =
            !t.lastMessage.isInbound &&
            (!lastReadAt || new Date(t.lastMessage.sentAt) > new Date(lastReadAt))
          return (
            <ThreadRow
              key={t.id}
              thread={t}
              isUnread={isUnread}
              onOpen={() => openThread(t.id, t.agent?.name ?? 'Conversation')}
            />
          )
        })}
        {nextCursor ? <div ref={sentinelRef} className='h-6' /> : null}
      </div>
      <FloatingSendPill onClick={handleNewThread} disabled={creating} />
    </Frame>
  )
}

function Frame({ children }: { children: preact.ComponentChildren }) {
  return (
    <div className='relative flex min-h-0 flex-1 flex-col bg-[color:var(--color-surface)]'>
      {children}
    </div>
  )
}

interface ThreadRowProps {
  thread: ThreadListItem
  isUnread: boolean
  onOpen: () => void
}

function ThreadRow({ thread, isUnread, onOpen }: ThreadRowProps) {
  const relative = formatRelativeTime(thread.lastMessage.sentAt)
  return (
    <button
      type='button'
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border border-transparent bg-[color:var(--color-bg)] px-3 py-2.5 text-left transition-colors hover:border-[color:var(--color-border)]'
      )}>
      <Avatar agent={thread.agent} />
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <div className='flex items-center justify-between gap-2'>
          <span className='truncate text-sm font-medium text-[color:var(--color-fg)]'>
            {thread.agent?.name ?? 'Support'}
          </span>
          <span className='shrink-0 text-[11px] text-[color:var(--color-muted)]'>{relative}</span>
        </div>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              isUnread
                ? 'font-medium text-[color:var(--color-fg)]'
                : 'text-[color:var(--color-muted)]'
            )}>
            {thread.lastMessage.isInbound ? 'You: ' : ''}
            {thread.lastMessage.snippet || 'No messages yet'}
          </span>
          {isUnread ? (
            <span
              className='size-2 shrink-0 rounded-full bg-[color:var(--color-primary)]'
              aria-label='Unread'
            />
          ) : null}
        </div>
      </div>
    </button>
  )
}

function Avatar({ agent }: { agent: ThreadListItem['agent'] }) {
  if (agent?.avatarUrl) {
    return (
      <img src={agent.avatarUrl} alt='' className='size-9 shrink-0 rounded-full object-cover' />
    )
  }
  return (
    <div className='flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-surface)] text-[color:var(--color-muted)]'>
      <User className='size-4' aria-hidden='true' />
    </div>
  )
}

function FloatingSendPill({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-3 flex justify-center'>
      <button
        type='button'
        onClick={onClick}
        disabled={disabled}
        className='pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[color:var(--color-primary)] px-4 py-2 text-sm font-medium text-[color:var(--color-primary-foreground)] shadow-md transition-opacity hover:brightness-110 disabled:opacity-50'>
        <Plus className='size-4' aria-hidden='true' />
        Send us a message
      </button>
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return 'now'
  if (diff < hour) return `${Math.floor(diff / minute)}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`
  return new Date(t).toLocaleDateString()
}
