// apps/api/src/routes/chat/messages.ts

import { ProviderRegistryService } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-messages-route')

const messagesRoute = new Hono()

messagesRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/messages
 *
 * Visitor sends a chat message. Body:
 * `{ threadId, content, clientMessageId?, attachmentIds? }`.
 *
 * Resolves `ChatProvider` from the provider registry and calls
 * `receiveMessage` — that path writes the Message row, attaches files, bumps
 * the Thread, publishes realtime, and enqueues an agent run if configured.
 */
messagesRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const body = (await c.req.json().catch(() => ({}))) as {
    threadId?: string
    content?: string
    clientMessageId?: string
    attachmentIds?: string[]
  }

  if (!body.threadId || !body.content) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'threadId and content are required' },
      },
      400
    )
  }

  try {
    const registry = new ProviderRegistryService(chat.organizationId)
    const provider = (await registry.getProvider(chat.channelId)) as any
    if (typeof provider.receiveMessage !== 'function') {
      return c.json(
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Channel does not support inbound messages' },
        },
        500
      )
    }

    const result = await provider.receiveMessage({
      threadId: body.threadId,
      fromParticipantId: chat.visitorParticipantId,
      content: body.content,
      clientMessageId: body.clientMessageId,
      attachmentIds: body.attachmentIds,
    })

    return c.json({
      success: true,
      data: {
        messageId: result.messageId,
        threadId: result.threadId,
        status: 'delivered',
        createdAt: new Date(),
      },
    })
  } catch (error) {
    log.error('Failed to send chat message', {
      threadId: body.threadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send message' } },
      500
    )
  }
})

export default messagesRoute
