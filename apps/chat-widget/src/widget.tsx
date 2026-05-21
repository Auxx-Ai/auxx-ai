// apps/chat-widget/src/widget.tsx

import { useEffect, useRef, useState } from 'preact/hooks'
import { ChatPanel } from './chat-window'
import { type ChatMessage, chatApi, type InitializeResponse } from './transport/chat-api'
import { type ChatConfig, fetchChatConfig } from './transport/config'
import { connectPusher, type PusherConnection } from './transport/pusher'

interface WidgetProps {
  channelId: string
}

export function Widget({ channelId }: WidgetProps) {
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [session, setSession] = useState<InitializeResponse | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pusherRef = useRef<PusherConnection | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(false)
  const api = useRef(chatApi(channelId)).current

  // Load config once on mount.
  useEffect(() => {
    fetchChatConfig(channelId)
      .then((c) => {
        setConfig(c)
        if (c.appearance.autoOpen) setOpen(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chat'))
  }, [channelId])

  // Initialize session when the widget is first opened.
  useEffect(() => {
    if (!open || session || !config) return
    let cancelled = false
    setError(null)
    api
      .initialize({
        url: window.location.href,
        referrer: document.referrer || undefined,
        userAgent: navigator.userAgent,
      })
      .then((res) => {
        if (cancelled) return
        setSession(res)
        setMessages(res.messages)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to start chat')
      })
    return () => {
      cancelled = true
    }
  }, [open, session, config, api])

  // Subscribe to Pusher once the session exists.
  useEffect(() => {
    if (!session || !config) return
    const conn = connectPusher({
      key: config.realtime.key,
      cluster: config.realtime.cluster,
      channelName: session.pusherChannel,
    })
    pusherRef.current = conn

    conn.channel.bind('new-message', (message: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev
        return [...prev, message]
      })
      if (message.sender !== 'USER') {
        api.markDelivered([message.id]).catch(() => {})
      }
    })

    return () => {
      conn.disconnect()
      pusherRef.current = null
    }
  }, [session, config, api])

  // Move focus on open/close transitions. Skip the very first render so we
  // don't yank focus on initial mount if autoOpen is off.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (open) inputRef.current?.focus()
    else triggerRef.current?.focus()
  }, [open])

  const handleSend = async (content: string) => {
    if (!session) return
    setSending(true)
    setError(null)
    const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const optimistic: ChatMessage = {
      id: clientMessageId,
      content,
      sender: 'USER',
      createdAt: new Date().toISOString(),
      status: 'sending',
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await api.sendMessage({
        sessionId: session.sessionId,
        threadId: session.threadId,
        content,
        clientMessageId,
      })
      setMessages((prev) =>
        prev.map((m) =>
          m.id === clientMessageId
            ? { ...m, id: res.messageId, status: res.status, createdAt: res.createdAt }
            : m
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
      setMessages((prev) => prev.filter((m) => m.id !== clientMessageId))
    } finally {
      setSending(false)
    }
  }

  if (!config) return null

  const positionClass = config.appearance.position.toLowerCase().includes('left')
    ? 'auxx-chat-shell--bottom-left'
    : 'auxx-chat-shell--bottom-right'
  const stateClass = open ? 'auxx-chat-shell--open' : 'auxx-chat-shell--closed'

  const rootStyle = { '--auxx-chat-primary': config.appearance.primaryColor } as Record<
    string,
    string
  >

  return (
    <div class='auxx-chat-root' style={rootStyle}>
      <div class={`auxx-chat-shell ${stateClass} ${positionClass}`}>
        <button
          ref={triggerRef}
          type='button'
          class='auxx-chat-shell__trigger'
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close chat' : 'Open chat'}
          aria-expanded={open}
          tabIndex={open ? -1 : 0}
        />
        <span class='auxx-chat-shell__icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
            <path d='M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2z' />
          </svg>
        </span>
        <div
          class='auxx-chat-shell__panel'
          role='dialog'
          aria-modal='false'
          aria-label={config.appearance.title}
          aria-hidden={!open}>
          <ChatPanel
            config={config}
            messages={messages}
            sending={sending}
            error={error}
            inputRef={inputRef}
            onClose={() => setOpen(false)}
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  )
}
