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
import type { ChatConfig } from '~/transport/config'
import type { ThreadCreatedEvent, ThreadUpdatedEvent } from '~/transport/visitor-channel'

interface MessagesViewProps {
  channelId: string
  config: ChatConfig
  subscribe?: {
    onThreadUpdated: (cb: (e: ThreadUpdatedEvent) => void) => () => void
    onThreadCreated: (cb: (e: ThreadCreatedEvent) => void) => () => void
  }
}

export function MessagesView({ channelId, config, subscribe }: MessagesViewProps) {
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

  const fallbackAgentName = config.agent?.name ?? 'Support'
  const fallbackAgentAvatar = config.agent?.avatarUrl ?? null

  const handleNewThread = useCallback(async () => {
    if (creating) return
    // Reuse the most recent existing thread if there is one — we only want
    // visitors to accumulate a single ongoing conversation, not a new thread
    // per click.
    if (threads.length > 0) {
      const top = threads[0]
      openThread(top.id, top.agent?.name ?? fallbackAgentName)
      return
    }
    setCreating(true)
    try {
      const { threadId } = await api.createThread({
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      })
      openThread(threadId, fallbackAgentName)
    } finally {
      setCreating(false)
    }
  }, [api, creating, openThread, threads, fallbackAgentName])

  if (loading && threads.length === 0) {
    return (
      <Frame>
        <div className='flex flex-1 items-center justify-center text-xs text-muted-foreground'>
          Loading…
        </div>
      </Frame>
    )
  }

  if (error && threads.length === 0) {
    return (
      <Frame>
        <div className='flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground'>
          {error}
        </div>
      </Frame>
    )
  }

  if (threads.length === 0) {
    return (
      <Frame>
        <div className='flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center'>
          <div className='flex size-12 items-center justify-center rounded-full bg-muted'>
            <MessageCircle className='size-6 text-muted-foreground' aria-hidden='true' />
          </div>
          <div className='flex flex-col gap-1'>
            <p className='text-sm font-medium text-foreground'>No conversations yet</p>
            <p className='text-xs text-muted-foreground'>
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
              fallbackName={fallbackAgentName}
              fallbackAvatarUrl={fallbackAgentAvatar}
              onOpen={() => openThread(t.id, t.agent?.name ?? fallbackAgentName)}
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
  return <div className='auxx-chat-frame relative flex min-h-0 flex-1 flex-col'>{children}</div>
}

interface ThreadRowProps {
  thread: ThreadListItem
  isUnread: boolean
  fallbackName: string
  fallbackAvatarUrl: string | null
  onOpen: () => void
}

function ThreadRow({ thread, isUnread, fallbackName, fallbackAvatarUrl, onOpen }: ThreadRowProps) {
  const relative = formatRelativeTime(thread.lastMessage.sentAt)
  const displayName = thread.agent?.name ?? fallbackName
  const displayAvatarUrl = thread.agent?.avatarUrl ?? fallbackAvatarUrl
  return (
    <button
      type='button'
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--auxx-chat-surface-dark-faint)]'
      )}>
      <Avatar avatarUrl={displayAvatarUrl} />
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <div className='flex items-center justify-between gap-2'>
          <span className='truncate text-sm font-medium text-foreground'>{displayName}</span>
          <span className='shrink-0 text-[11px] text-muted-foreground'>{relative}</span>
        </div>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              isUnread ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}>
            {thread.lastMessage.isInbound ? 'You: ' : ''}
            {thread.lastMessage.snippet || 'No messages yet'}
          </span>
          {isUnread ? (
            <span className='size-2 shrink-0 rounded-full bg-primary' aria-label='Unread' />
          ) : null}
        </div>
      </div>
    </button>
  )
}

function Avatar({ avatarUrl }: { avatarUrl: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt='' className='size-9 shrink-0 rounded-full object-cover' />
  }
  return (
    <div className='flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'>
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
        className='pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-opacity hover:brightness-110 disabled:opacity-50'>
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
