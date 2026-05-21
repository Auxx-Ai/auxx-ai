// apps/api/src/routes/chat/visitor-info.ts

import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders, getChatService } from './lib'

const log = createScopedLogger('chat-visitor-info-route')

const visitorInfoRoute = new Hono()

visitorInfoRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * PATCH /api/chat/visitor-info
 * Body: `{ sessionId, visitorName?, visitorEmail? }`
 */
visitorInfoRoute.patch('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const body = (await c.req.json().catch(() => ({}))) as {
    sessionId?: string
    visitorName?: string
    visitorEmail?: string
  }
  if (!body.sessionId) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'sessionId is required' } },
      400
    )
  }

  try {
    await getChatService().updateVisitorInfo(body.sessionId, {
      name: body.visitorName,
      email: body.visitorEmail,
    })
    return c.json({ success: true, data: {} })
  } catch (error) {
    log.error('Failed to update visitor info', {
      sessionId: body.sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update' } },
      500
    )
  }
})

export default visitorInfoRoute
