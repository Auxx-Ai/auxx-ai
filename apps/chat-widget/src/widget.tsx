// apps/chat-widget/src/widget.tsx

import { useEffect, useRef, useState } from 'preact/hooks'
import { ChatButton } from './chat-button'
import { ChatWindow } from './chat-window'
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
    ? 'auxx-chat-root--bottom-left'
    : 'auxx-chat-root--bottom-right'

  return (
    <div class={`auxx-chat-root ${positionClass}`}>
      {open && (
        <ChatWindow
          config={config}
          messages={messages}
          sending={sending}
          error={error}
          onClose={() => setOpen(false)}
          onSend={handleSend}
        />
      )}
      <ChatButton
        primaryColor={config.appearance.primaryColor}
        onClick={() => setOpen((v) => !v)}
      />
    </div>
  )
}
