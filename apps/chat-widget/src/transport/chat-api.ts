// apps/chat-widget/src/transport/chat-api.ts

import { authedFetch } from './api-client'

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
      authedFetch<InitializeResponse>(channelId, '/api/chat/initialize', {
        method: 'POST',
        body,
      }),

    sendMessage: (body: {
      sessionId: string
      threadId: string
      content: string
      clientMessageId?: string
    }) =>
      authedFetch<{ messageId: string; status: string; createdAt: string }>(
        channelId,
        '/api/chat/messages',
        { method: 'POST', body }
      ),

    getHistory: (threadId: string, sessionId: string) =>
      authedFetch<{ messages: ChatMessage[]; nextCursor: string | null }>(
        channelId,
        `/api/chat/threads/${threadId}/messages`,
        { method: 'GET', query: { sessionId } }
      ),

    setTyping: (sessionId: string, isTyping: boolean) =>
      authedFetch<Record<string, never>>(channelId, '/api/chat/typing', {
        method: 'POST',
        body: { sessionId, isTyping },
      }),

    markDelivered: (messageIds: string[]) =>
      authedFetch<{ updated: number }>(channelId, '/api/chat/receipts/delivered', {
        method: 'POST',
        body: { messageIds },
      }),

    markRead: (messageIds: string[]) =>
      authedFetch<{ updated: number }>(channelId, '/api/chat/receipts/read', {
        method: 'POST',
        body: { messageIds },
      }),

    createThread: (body: { url?: string; referrer?: string; userAgent?: string } = {}) =>
      authedFetch<{ threadId: string; pusherChannel: string }>(channelId, '/api/chat/threads', {
        method: 'POST',
        body,
      }),

    getRecentThread: () =>
      authedFetch<{
        thread: {
          id: string
          subject: string | null
          lastMessage: { preview: string; isInbound: boolean; timestamp: string }
        } | null
      }>(channelId, '/api/chat/threads/recent', { method: 'GET' }),

    updateVisitorInfo: (body: {
      threadId: string
      visitorName?: string
      visitorEmail?: string
      identify?: IdentifyApiPayload
    }) =>
      authedFetch<{ passport?: { token: string; expiresIn: string } }>(
        channelId,
        '/api/chat/visitor-info',
        {
          method: 'PATCH',
          body,
        }
      ),
  }
}
