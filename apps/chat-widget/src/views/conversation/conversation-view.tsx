// apps/chat-widget/src/views/conversation/conversation-view.tsx
//
// Body for the `thread` frame: loads history, subscribes to the per-session
// Pusher channel for live updates, renders grouped message bubbles, and hosts
// the composer at the bottom.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getStoredIdentify, type IdentifyPayload, onIdentify } from '~/identify'
import { dismissPrivacyBanner, isPrivacyBannerDismissed } from '~/persistence/privacy-banner'
import { markThreadRead } from '~/persistence/unread'
import { type ChatMessage, chatApi } from '~/transport/chat-api'
import type { ChatConfig } from '~/transport/config'
import { connectPrivatePusher, connectPusher } from '~/transport/pusher'
import {
  THREAD_EVENT_TYPES,
  type ThreadEvent,
  type ThreadEventData,
} from '~/transport/thread-events'
import { Bubble, type MessageGroup } from './bubble'
import { Composer, type ComposerSendArgs } from './composer/composer'
import { PrivacyBanner } from './privacy-banner'
import { SuggestedReplies } from './suggested-replies'
import { SystemLine } from './system-line'
import { WelcomeBubble } from './welcome-bubble'

interface ConversationViewProps {
  channelId: string
  threadId: string
  config: ChatConfig
}

interface InitState {
  sessionId: string
  pusherChannel: string
  threadPusherChannel: string
}

export function ConversationView({ channelId, threadId, config }: ConversationViewProps) {
  const api = useMemo(() => chatApi(channelId), [channelId])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [threadEvents, setThreadEvents] = useState<ThreadEvent[]>([])
  const [init, setInit] = useState<InitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [privacyDismissed, setPrivacyDismissed] = useState(() =>
    isPrivacyBannerDismissed(channelId)
  )
  const [identify, setIdentify] = useState<IdentifyPayload | null>(() =>
    getStoredIdentify(channelId)
  )
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Pick up later identify() calls so the welcome bubble's `visitor:*`
  // placeholders refresh in place.
  useEffect(() => onIdentify(setIdentify), [])

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
        setInit({
          sessionId: data.sessionId,
          pusherChannel: data.pusherChannel,
          threadPusherChannel: data.threadPusherChannel,
        })
        if (data.threadId === threadId) {
          setMessages(data.messages)
          setThreadEvents(data.threadEvents ?? [])
        } else {
          // Defensive: the server now honors `resumeThreadId` so this branch
          // shouldn't fire in practice. If it does, surface the error loudly
          // instead of silently rendering an empty transcript — that masks
          // real bugs as "thread reset to welcome bubble."
          api
            .getHistory(threadId, data.sessionId)
            .then((hist) => {
              if (cancelled) return
              setMessages(hist.messages)
              setThreadEvents(hist.threadEvents ?? [])
            })
            .catch((e) => {
              if (cancelled) return
              setError(e instanceof Error ? e.message : 'Failed to load conversation')
            })
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

  // Subscribe to the per-thread private channel for live lifecycle events
  // (taken_over / returned_to_ai / archived / reopened / …). The server pushes
  // these via the shared realtime helper; the widget binds the same set of
  // type names directly as Pusher event keys.
  useEffect(() => {
    if (!init) return
    const channelName = init.threadPusherChannel
    const expected = `private-thread-${threadId}`
    if (channelName !== expected) return
    const conn = connectPrivatePusher({
      key: config.realtime.key,
      cluster: config.realtime.cluster,
      channelName,
      channelId,
    })
    const handlers = THREAD_EVENT_TYPES.map((type) => {
      const handler = (payload: { id?: string; createdAt?: string } & ThreadEventData) => {
        if ((payload as { threadId?: string }).threadId !== threadId) return
        setThreadEvents((prev) => {
          // Dedupe by id when the server provides one; fall back to
          // (type, threadId, createdAt) for transient payloads.
          const id =
            payload.id ?? `${type}:${threadId}:${payload.createdAt ?? new Date().toISOString()}`
          if (prev.some((e) => e.id === id)) return prev
          return [
            ...prev,
            {
              id,
              type,
              createdAt: payload.createdAt ?? new Date().toISOString(),
              data: payload as ThreadEventData,
            },
          ]
        })
      }
      conn.channel.bind(type, handler)
      return { type, handler }
    })
    return () => {
      for (const { type, handler } of handlers) {
        try {
          conn.channel.unbind(type, handler)
        } catch {
          /* ignore */
        }
      }
      conn.disconnect()
    }
  }, [init, threadId, channelId, config.realtime.key, config.realtime.cluster])

  // Mark read whenever the last message changes.
  useEffect(() => {
    if (messages.length === 0) return
    markThreadRead(channelId, threadId)
  }, [channelId, threadId, messages.length])

  // Auto-scroll to bottom on new messages or thread events.
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, threadEvents.length])

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

  const timeline = useMemo(() => buildTimeline(messages, threadEvents), [messages, threadEvents])

  return (
    <div className='auxx-chat-frame flex min-h-0 flex-1 flex-col'>
      <div
        ref={bodyRef}
        className='auxx-chat-body-mask flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3'>
        {error ? (
          <div className='rounded bg-background p-2 text-center text-xs text-destructive'>
            {error}
          </div>
        ) : null}
        {init ? (
          <WelcomeBubble
            agent={config.agent}
            template={config.welcomeMessageTemplate}
            identify={identify}
            initialTyping={messages.length === 0}
          />
        ) : null}
        {timeline.map((item, i) =>
          item.kind === 'event' ? (
            <SystemLine key={`e-${item.event.id}`} event={item.event} />
          ) : (
            <Bubble key={`g-${i}`} group={item.group} />
          )
        )}
      </div>
      {/* "Loud" plinth — suggested replies, composer, privacy banner sit on a
       * tinted surface strip. The plinth's ::before pseudo feathers the body's
       * bottom edge into the plinth so there's no hard seam. */}
      <div className='auxx-chat-composer-plinth'>
        {init && messages.length === 0 ? (
          <SuggestedReplies
            replies={config.suggestedReplies ?? []}
            onSelect={(text) => handleSend({ content: text, attachmentIds: [] })}
          />
        ) : null}
        <Composer channelId={channelId} onSend={handleSend} />
        {config.privacyPolicyUrl && !privacyDismissed ? (
          <PrivacyBanner
            url={config.privacyPolicyUrl}
            onDismiss={() => {
              dismissPrivacyBanner(channelId)
              setPrivacyDismissed(true)
            }}
          />
        ) : null}
      </div>
      {config.branding.footerEnabled ? (
        <div className='border-t border-[color:var(--auxx-chat-hairline)] bg-transparent py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground'>
          Powered by Auxx
        </div>
      ) : null}
    </div>
  )
}

type TimelineItem =
  | { kind: 'group'; group: MessageGroup; createdAt: number }
  | { kind: 'event'; event: ThreadEvent; createdAt: number }

/**
 * Interleave messages and thread events by `createdAt`. Consecutive messages
 * from the same sender are grouped into a single bubble cluster; any event
 * between them breaks the cluster.
 */
function buildTimeline(messages: ChatMessage[], events: ThreadEvent[]): TimelineItem[] {
  type Entry =
    | { kind: 'message'; createdAt: number; message: ChatMessage }
    | { kind: 'event'; createdAt: number; event: ThreadEvent }
  const entries: Entry[] = [
    ...messages.map((m) => ({
      kind: 'message' as const,
      createdAt: new Date(m.createdAt).getTime(),
      message: m,
    })),
    ...events.map((e) => ({
      kind: 'event' as const,
      createdAt: new Date(e.createdAt).getTime(),
      event: e,
    })),
  ]
  entries.sort((a, b) => a.createdAt - b.createdAt)

  const out: TimelineItem[] = []
  for (const entry of entries) {
    if (entry.kind === 'event') {
      out.push({ kind: 'event', event: entry.event, createdAt: entry.createdAt })
      continue
    }
    const last = out[out.length - 1]
    if (last && last.kind === 'group' && last.group.sender === entry.message.sender) {
      last.group.messages.push(entry.message)
    } else {
      out.push({
        kind: 'group',
        group: { sender: entry.message.sender, messages: [entry.message] },
        createdAt: entry.createdAt,
      })
    }
  }
  return out
}
