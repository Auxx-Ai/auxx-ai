// apps/api/src/routes/chat/visitor-info.ts

import { database } from '@auxx/database'
import { patchChatThreadMetadata } from '@auxx/lib/chat'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-visitor-info-route')

const visitorInfoRoute = new Hono()

visitorInfoRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * PATCH /api/chat/visitor-info
 * Body: `{ threadId, visitorName?, visitorEmail? }`
 *
 * Updates the claimed visitor identity on the thread's chat metadata. Phase 4
 * dropped the legacy `sessionId` payload — visitor info lives on `Thread.metadata`.
 */
visitorInfoRoute.patch('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const body = (await c.req.json().catch(() => ({}))) as {
    threadId?: string
    visitorName?: string
    visitorEmail?: string
  }
  if (!body.threadId) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'threadId is required' } },
      400
    )
  }

  try {
    await patchChatThreadMetadata(
      { db: database, organizationId: chat.organizationId },
      body.threadId,
      {
        claimedVisitorName: body.visitorName,
        claimedVisitorEmail: body.visitorEmail,
      }
    )
    return c.json({ success: true, data: {} })
  } catch (error) {
    log.error('Failed to update visitor info', {
      threadId: body.threadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update' } },
      500
    )
  }
})

export default visitorInfoRoute
