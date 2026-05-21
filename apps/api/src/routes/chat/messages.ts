// apps/api/src/routes/chat/messages.ts

import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders, getChatService } from './lib'

const log = createScopedLogger('chat-messages-route')

const messagesRoute = new Hono()

messagesRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/messages
 *
 * Visitor sends a chat message.
 * Body: `{ sessionId, threadId, content, clientMessageId?, attachmentIds? }`.
 */
messagesRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const body = (await c.req.json().catch(() => ({}))) as {
    sessionId?: string
    threadId?: string
    content?: string
    clientMessageId?: string
    attachmentIds?: string[]
  }

  if (!body.sessionId || !body.threadId || !body.content) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'sessionId, threadId and content are required' },
      },
      400
    )
  }

  try {
    const service = getChatService()
    const message = await service.sendUserMessage({
      sessionId: body.sessionId,
      threadId: body.threadId,
      content: body.content,
      clientMessageId: body.clientMessageId,
      attachmentIds: body.attachmentIds,
    })

    return c.json({
      success: true,
      data: { messageId: message.id, status: message.status, createdAt: message.createdAt },
    })
  } catch (error) {
    log.error('Failed to send chat message', {
      sessionId: body.sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send message' } },
      500
    )
  }
})

export default messagesRoute
