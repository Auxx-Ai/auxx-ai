// apps/api/src/routes/chat/initialize.ts

import { database, schema } from '@auxx/database'
import { initializeOrResumeChatThread } from '@auxx/lib/chat'
import { createScopedLogger } from '@auxx/logger'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-initialize-route')

const initializeRoute = new Hono()

initializeRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/initialize
 *
 * Bootstrap or resume the chat thread for the authenticated visitor.
 * Body: `{ url?, referrer?, userAgent?, visitorName?, visitorEmail? }`.
 *
 * Returns `{ threadId, visitorId, isNewSession, messages, pusherChannel }`.
 * The legacy `sessionId` field is no longer returned — the embedded widget
 * tracks the chat by thread id (`pusherChannel: chat-${threadId}`).
 */
initializeRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const body = await c.req.json().catch(() => ({}))

  try {
    const result = await initializeOrResumeChatThread(
      { db: database, organizationId: chat.organizationId },
      {
        channelId: chat.channelId,
        visitorId: chat.sessionId,
        visit: {
          url: typeof body.url === 'string' ? body.url : undefined,
          referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
          userAgent: typeof body.userAgent === 'string' ? body.userAgent : undefined,
          ipAddress:
            c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
            c.req.header('x-real-ip') ||
            undefined,
        },
        visitorName: typeof body.visitorName === 'string' ? body.visitorName : undefined,
        visitorEmail: typeof body.visitorEmail === 'string' ? body.visitorEmail : undefined,
      }
    )

    if (result.error) {
      log.error('Failed to initialize chat thread', {
        channelId: chat.channelId,
        error: result.error.message,
      })
      return c.json(
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to initialize chat session' },
        },
        500
      )
    }

    const { thread, isNew, visitorChatSessionId } = result.value

    // Load existing messages on resume so the widget can rehydrate.
    const rows = isNew
      ? []
      : await database
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
          .where(eq(schema.Message.threadId, thread.id))
          .orderBy(asc(schema.Message.sentAt))

    const messages = rows.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      content: m.textPlain ?? m.textHtml ?? '',
      sender: m.isInbound ? 'USER' : 'AGENT',
      timestamp: m.sentAt ?? m.createdAt,
      status: 'DELIVERED',
    }))

    return c.json({
      success: true,
      data: {
        threadId: thread.id,
        visitorId: chat.sessionId,
        isNewSession: isNew,
        messages,
        pusherChannel: `chat-${visitorChatSessionId}`,
      },
    })
  } catch (error) {
    log.error('Failed to initialize chat session', {
      channelId: chat.channelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to initialize chat session',
        },
      },
      500
    )
  }
})

export default initializeRoute
