// apps/chat-widget/src/transport/chat-api.ts

import { getChatPassport } from './passport'

export interface ChatMessage {
  id: string
  content: string
  sender: 'USER' | 'AGENT' | 'SYSTEM'
  createdAt: string
  status?: string
  agent?: { id?: string; name?: string; image?: string | null }
}

export interface InitializeResponse {
  sessionId: string
  threadId: string
  visitorId: string
  isNewSession: boolean
  messages: ChatMessage[]
  pusherChannel: string
  visitorPusherChannel: string
  passport?: { token: string; expiresIn: string }
}

export interface IdentifyApiPayload {
  name?: string
  email?: string
  externalId?: string
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

async function call<T>(
  channelId: string,
  path: string,
  init: { method: string; body?: unknown; query?: Record<string, string> }
): Promise<T> {
  const doFetch = async (token: string) => {
    let url = `${__AUXX_API_BASE_URL__}${path}`
    if (init.query) {
      const qs = new URLSearchParams(init.query).toString()
      if (qs) url += `?${qs}`
    }
    return fetch(url, {
      method: init.method,
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  }

  let { passport } = await getChatPassport(channelId)
  let res = await doFetch(passport)

  if (res.status === 401) {
    passport = (await getChatPassport(channelId, { force: true })).passport
    res = await doFetch(passport)
  }

  const json = (await res.json()) as ApiEnvelope<T>
  if (!res.ok || !json.success || json.data === undefined) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`)
  }
  return json.data
}

export function chatApi(channelId: string) {
  return {
    initialize: (body: {
      url?: string
      referrer?: string
      userAgent?: string
      visitorName?: string
      visitorEmail?: string
      sessionId?: string
      threadId?: string
      identify?: IdentifyApiPayload
    }) =>
      call<InitializeResponse>(channelId, '/api/chat/initialize', {
        method: 'POST',
        body,
      }),

    sendMessage: (body: {
      sessionId: string
      threadId: string
      content: string
      clientMessageId?: string
    }) =>
      call<{ messageId: string; status: string; createdAt: string }>(
        channelId,
        '/api/chat/messages',
        { method: 'POST', body }
      ),

    getHistory: (threadId: string, sessionId: string) =>
      call<{ messages: ChatMessage[]; nextCursor: string | null }>(
        channelId,
        `/api/chat/threads/${threadId}/messages`,
        { method: 'GET', query: { sessionId } }
      ),

    setTyping: (sessionId: string, isTyping: boolean) =>
      call<Record<string, never>>(channelId, '/api/chat/typing', {
        method: 'POST',
        body: { sessionId, isTyping },
      }),

    markDelivered: (messageIds: string[]) =>
      call<{ updated: number }>(channelId, '/api/chat/receipts/delivered', {
        method: 'POST',
        body: { messageIds },
      }),

    markRead: (messageIds: string[]) =>
      call<{ updated: number }>(channelId, '/api/chat/receipts/read', {
        method: 'POST',
        body: { messageIds },
      }),

    updateVisitorInfo: (body: {
      threadId: string
      visitorName?: string
      visitorEmail?: string
      identify?: IdentifyApiPayload
    }) =>
      call<{ passport?: { token: string; expiresIn: string } }>(
        channelId,
        '/api/chat/visitor-info',
        {
          method: 'PATCH',
          body,
        }
      ),
  }
}
