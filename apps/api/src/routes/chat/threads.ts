// apps/api/src/routes/chat/threads.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-threads-route')

const threadsRoute = new Hono()

threadsRoute.options('/:threadId/messages', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
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
