// apps/chat-widget/src/views/conversation/conversation-view.tsx
//
// Body for the `thread` frame: loads history, subscribes to the per-session
// Pusher channel for live updates, renders grouped message bubbles, and hosts
// the composer at the bottom.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getStoredIdentify, type IdentifyPayload, onIdentify } from '~/identify'
import { dismissPrivacyBanner, isPrivacyBannerDismissed } from '~/persistence/privacy-banner'
import { markThreadRead } from '~/persistence/unread'
import { type ChatAttachment, type ChatMessage, chatApi } from '~/transport/chat-api'
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
  // Track every `URL.createObjectURL(...)` we hand off as an optimistic
  // preview so we can revoke them on Pusher reconcile or widget unmount. A
  // missed revoke leaks memory per send.
  const objectUrlsRef = useRef<Set<string>>(new Set())

  // Pick up later identify() calls so the welcome bubble's `visitor:*`
  // placeholders refresh in place.
  useEffect(() => onIdentify(setIdentify), [])

  // Revoke any outstanding optimistic blob URLs on unmount.
  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      }
      objectUrlsRef.current.clear()
    },
    []
  )

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
      clientMessageId?: string
      attachments?: ChatAttachment[]
    }) => {
      if (data.threadId !== threadId) return
      setMessages((prev) => {
        // Match against either the server id (echo on a second tab) or the
        // optimistic clientMessageId (own send round-tripping back). Merge
        // server attachments onto the optimistic entry rather than replacing,
        // so the local objectUrl previews don't flash. Once the merge lands
        // we revoke the optimistic blob URLs — we know the server payload
        // is now driving the render.
        const idx = prev.findIndex(
          (m) => m.id === data.id || (data.clientMessageId && m.id === data.clientMessageId)
        )
        if (idx >= 0) {
          const existing = prev[idx]!
          const mergedAttachments = mergeAttachments(existing.attachments, data.attachments)
          revokeOptimisticUrls(existing.attachments, objectUrlsRef.current)
          const next = prev.slice()
          next[idx] = {
            ...existing,
            id: data.id,
            content: data.content || existing.content,
            createdAt: data.createdAt || existing.createdAt,
            status: 'delivered',
            ...(mergedAttachments ? { attachments: mergedAttachments } : {}),
          }
          return next
        }
        return [
          ...prev,
          {
            id: data.id,
            content: data.content,
            sender: (data.sender as ChatMessage['sender']) ?? 'AGENT',
            createdAt: data.createdAt,
            ...(data.attachments?.length ? { attachments: data.attachments } : {}),
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
    async ({ content, attachmentIds, inflight }: ComposerSendArgs) => {
      if (!init) return
      const clientMessageId = `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const optimisticAttachments: ChatAttachment[] | undefined =
        inflight && inflight.length > 0
          ? inflight
              .filter((a) => a.assetId)
              .map((a) => {
                if (a.objectUrl) objectUrlsRef.current.add(a.objectUrl)
                return {
                  id: a.assetId!,
                  name: a.name,
                  mimeType: a.type,
                  size: a.size,
                  ...(a.objectUrl ? { objectUrl: a.objectUrl } : {}),
                }
              })
          : undefined
      const optimistic: ChatMessage = {
        id: clientMessageId,
        content,
        sender: 'USER',
        createdAt: new Date().toISOString(),
        status: 'sending',
        ...(optimisticAttachments?.length ? { attachments: optimisticAttachments } : {}),
      }
      setMessages((prev) => [...prev, optimistic])
      try {
        await api.sendMessage({
          sessionId: init.sessionId,
          threadId,
          content,
          clientMessageId,
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        })
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
            <Bubble key={`g-${i}`} group={item.group} channelId={channelId} />
          )
        )}
      </div>
      {/* "Loud" plinth — suggested replies, composer, privacy banner sit on a
       * tinted surface strip. The plinth's ::before pseudo feathers the body's
       * bottom edge into the plinth so there's no hard seam.
       *
       * Offline mode (no AI agent bound AND nobody on duty): swap the composer
       * for a muted notice. Suggested replies + privacy banner would have
       * nothing to act on so we drop them too. */}
      <div className='auxx-chat-composer-plinth'>
        {config.isOffline ? (
          <OfflineNotice message={config.appearance.offlineMessage} />
        ) : (
          <>
            {init && messages.length === 0 ? (
              <SuggestedReplies
                replies={config.suggestedReplies ?? []}
                onSelect={(text) => handleSend({ content: text, attachmentIds: [], inflight: [] })}
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
          </>
        )}
      </div>
      {config.branding.footerEnabled ? (
        <div className='border-t border-[color:var(--auxx-chat-hairline)] bg-transparent py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground'>
          Powered by Auxx
        </div>
      ) : null}
    </div>
  )
}

function OfflineNotice({ message }: { message: string | null }) {
  const text =
    message?.trim() || 'No one is available right now. Leave a message and we’ll reply by email.'
  return (
    <div className='mx-1 mb-1 rounded-md border border-[color:var(--auxx-chat-hairline)] bg-background/60 px-3 py-3 text-center text-xs text-muted-foreground'>
      {text}
    </div>
  )
}

/**
 * Merge attachments from a server payload onto an existing optimistic entry.
 * The server is canonical for ids/order; optimistic entries only contribute
 * `objectUrl` so the visitor doesn't see a flash on reconcile.
 *
 * Optimistic ids are MediaAsset ids (from the upload POST response); server
 * ids are Attachment ids, so id-based matching fails on reconcile. When
 * counts match, fall back to position-based zipping — the visitor sends in
 * the order they picked, server preserves it via `Attachment.sort`.
 */
function mergeAttachments(
  optimistic: ChatAttachment[] | undefined,
  server: ChatAttachment[] | undefined
): ChatAttachment[] | undefined {
  if (!server || server.length === 0)
    return optimistic && optimistic.length > 0 ? optimistic : undefined
  if (!optimistic || optimistic.length === 0) return server
  if (optimistic.length === server.length) {
    return server.map((s, i) => {
      const o = optimistic[i]
      return o?.objectUrl ? { ...s, objectUrl: o.objectUrl } : s
    })
  }
  const byId = new Map(optimistic.map((a) => [a.id, a]))
  return server.map((s) => {
    const o = byId.get(s.id)
    return o?.objectUrl ? { ...s, objectUrl: o.objectUrl } : s
  })
}

/** Revoke any blob URLs we created for the optimistic preview. */
function revokeOptimisticUrls(
  attachments: ChatAttachment[] | undefined,
  tracked: Set<string>
): void {
  if (!attachments) return
  for (const a of attachments) {
    if (a.objectUrl && tracked.has(a.objectUrl)) {
      try {
        URL.revokeObjectURL(a.objectUrl)
      } catch {
        /* ignore */
      }
      tracked.delete(a.objectUrl)
    }
  }
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
