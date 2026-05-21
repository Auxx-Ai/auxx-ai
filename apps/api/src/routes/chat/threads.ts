// apps/api/src/routes/chat/threads.ts

import { database, schema } from '@auxx/database'
import { initializeOrResumeChatThread } from '@auxx/lib/chat'
import type { ChatThreadMetadata } from '@auxx/lib/threads/types'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-threads-route')

const threadsRoute = new Hono()

threadsRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

threadsRoute.options('/recent', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

threadsRoute.options('/:threadId/messages', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/threads
 *
 * Create a fresh chat thread for the visitor. Always creates — the resume
 * path lives on `POST /api/chat/initialize`. Used by the Home "Send us a
 * message" CTA so every tap lands the visitor in a new conversation.
 */
threadsRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  const chat = c.get('chat')
  const body = await c.req.json().catch(() => ({}))

  const result = await initializeOrResumeChatThread(
    { db: database, organizationId: chat.organizationId },
    {
      channelId: chat.channelId,
      visitorId: chat.sessionId,
      forceNewThread: true,
      visit: {
        url: typeof body.url === 'string' ? body.url : undefined,
        referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
        userAgent: typeof body.userAgent === 'string' ? body.userAgent : undefined,
      },
      visitorName: chat.identify?.name,
      visitorEmail: chat.identify?.email,
      visitorExternalId: chat.identify?.externalId,
    }
  )

  if (result.error) {
    log.error('Failed to create chat thread', {
      channelId: chat.channelId,
      error: result.error.message,
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create thread' } },
      500
    )
  }

  return c.json({
    success: true,
    data: {
      threadId: result.value.thread.id,
      pusherChannel: `chat-${result.value.visitorChatSessionId}`,
    },
  })
})

/**
 * GET /api/chat/threads/recent
 *
 * Return the visitor's most recently active thread + a one-line preview for
 * the Home "Recent message" card. Returns `{ thread: null }` when the visitor
 * has no threads on this channel.
 */
threadsRoute.get('/recent', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  const chat = c.get('chat')

  try {
    const threads = await database
      .select()
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.organizationId, chat.organizationId),
          eq(schema.Thread.integrationId, chat.channelId)
        )
      )
      .orderBy(desc(schema.Thread.lastMessageAt))
      .limit(20)

    const recent = threads.find((t) => {
      const meta = (t.metadata ?? {}) as Partial<ChatThreadMetadata>
      return meta.channel === 'chat' && meta.visitorParticipantId === chat.visitorParticipantId
    })

    if (!recent) {
      return c.json({ success: true, data: { thread: null } })
    }

    const [lastMessage] = await database
      .select({
        textPlain: schema.Message.textPlain,
        textHtml: schema.Message.textHtml,
        isInbound: schema.Message.isInbound,
        sentAt: schema.Message.sentAt,
        createdAt: schema.Message.createdAt,
      })
      .from(schema.Message)
      .where(eq(schema.Message.threadId, recent.id))
      .orderBy(desc(schema.Message.sentAt))
      .limit(1)

    if (!lastMessage) {
      return c.json({ success: true, data: { thread: null } })
    }

    return c.json({
      success: true,
      data: {
        thread: {
          id: recent.id,
          subject: recent.subject,
          lastMessage: {
            preview: (lastMessage.textPlain ?? lastMessage.textHtml ?? '').slice(0, 160),
            isInbound: lastMessage.isInbound,
            timestamp: lastMessage.sentAt ?? lastMessage.createdAt,
          },
        },
      },
    })
  } catch (error) {
    log.error('Failed to load recent chat thread', {
      channelId: chat.channelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load thread' } },
      500
    )
  }
})

/**
 * GET /api/chat/threads/:threadId/messages
 *
 * Returns the message history for the visitor's current thread. Ownership is
 * enforced by joining on org id from the passport — a leaked passport from one
 * org can never read another org's threads.
 */
threadsRoute.get('/:threadId/messages', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const threadId = c.req.param('threadId')

  try {
    const [thread] = await database
      .select({ id: schema.Thread.id })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.id, threadId),
          eq(schema.Thread.organizationId, chat.organizationId),
          eq(schema.Thread.integrationId, chat.channelId)
        )
      )
      .limit(1)
    if (!thread) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Thread not found' } },
        404
      )
    }

    const rows = await database
      .select({
        id: schema.Message.id,
        threadId: schema.Message.threadId,
        textPlain: schema.Message.textPlain,
        textHtml: schema.Message.textHtml,
        isInbound: schema.Message.isInbound,
        sentAt: schema.Message.sentAt,
        createdAt: schema.Message.createdAt,
      })
      .from(schema.Message)
      .where(eq(schema.Message.threadId, threadId))
      .orderBy(asc(schema.Message.sentAt))

    const messages = rows.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      content: m.textPlain ?? m.textHtml ?? '',
      sender: m.isInbound ? 'USER' : 'AGENT',
      timestamp: m.sentAt ?? m.createdAt,
      status: 'DELIVERED',
    }))

    return c.json({ success: true, data: { messages, nextCursor: null } })
  } catch (error) {
    log.error('Failed to load chat history', {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load history' } },
      500
    )
  }
})

export default threadsRoute
