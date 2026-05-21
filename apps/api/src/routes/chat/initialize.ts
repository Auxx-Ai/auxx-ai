// apps/api/src/routes/chat/initialize.ts

import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders, getChatService } from './lib'

const log = createScopedLogger('chat-initialize-route')

const initializeRoute = new Hono()

initializeRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/initialize
 *
 * Bootstrap or resume the chat session for the authenticated visitor.
 * Body: `{ url?, referrer?, userAgent?, visitorName?, visitorEmail?,
 *          sessionId?, threadId? }`.
 *
 * Returns `{ sessionId, threadId, visitorId, isNewSession, messages,
 *           pusherChannel }`.
 */
initializeRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const body = await c.req.json().catch(() => ({}))

  try {
    const service = getChatService()
    const result = await service.initializeOrResumeSession({
      integrationId: chat.channelId,
      visitorId: chat.visitorParticipantId,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
      userAgent: typeof body.userAgent === 'string' ? body.userAgent : undefined,
      ipAddress:
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        undefined,
      visitorName: typeof body.visitorName === 'string' ? body.visitorName : undefined,
      visitorEmail: typeof body.visitorEmail === 'string' ? body.visitorEmail : undefined,
    })

    return c.json({
      success: true,
      data: {
        sessionId: result.sessionId,
        threadId: result.threadId,
        visitorId: result.visitorId,
        isNewSession: result.isNewSession,
        messages: result.messages,
        pusherChannel: `chat-${result.sessionId}`,
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
