// apps/chat-widget/src/transport/chat-api.ts

import { authedFetch } from './api-client'
import type { ThreadEvent } from './thread-events'

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
  /** Persisted thread lifecycle events (taken_over / archived / …). */
  threadEvents: ThreadEvent[]
  pusherChannel: string
  /** Private per-thread channel for live lifecycle events. */
  threadPusherChannel: string
  visitorPusherChannel: string
  passport?: { token: string; expiresIn: string }
}

export interface IdentifyApiPayload {
  name?: string
  email?: string
  externalId?: string
}

export interface ThreadListItem {
  id: string
  agent: { id: string; name: string; avatarUrl: string | null } | null
  lastMessage: { snippet: string; sentAt: string; isInbound: boolean }
  updatedAt: string
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
    }) => {
      const { threadId, ...rest } = body
      return authedFetch<{ messageId: string; status: string; createdAt: string }>(
        channelId,
        `/api/chat/threads/${threadId}/messages`,
        { method: 'POST', body: rest }
      )
    },

    getHistory: (threadId: string, sessionId: string) =>
      authedFetch<{
        messages: ChatMessage[]
        threadEvents: ThreadEvent[]
        nextCursor: string | null
      }>(channelId, `/api/chat/threads/${threadId}/messages`, {
        method: 'GET',
        query: { sessionId },
      }),

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
          lastMessage: { preview: string; isInbound: boolean; timestamp: string } | null
        } | null
      }>(channelId, '/api/chat/threads/recent', { method: 'GET' }),

    listThreads: (cursor: string | null = null) => {
      const query: Record<string, string> = {}
      if (cursor) query.cursor = cursor
      return authedFetch<{
        items: ThreadListItem[]
        nextCursor: string | null
      }>(channelId, '/api/chat/threads', { method: 'GET', query })
    },

    getTranscript: (threadId: string) =>
      authedFetch<{ html: string; filename: string }>(
        channelId,
        `/api/chat/threads/${threadId}/transcript`,
        { method: 'POST' }
      ),

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
