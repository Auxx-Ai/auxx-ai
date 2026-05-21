// apps/api/src/routes/chat/threads.ts

import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders, getChatService } from './lib'

const log = createScopedLogger('chat-threads-route')

const threadsRoute = new Hono()

threadsRoute.options('/:threadId/messages', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * GET /api/chat/threads/:threadId/messages
 *
 * Returns the message history for the visitor's current session.
 * `threadId` is passed by the widget for symmetry with the bundle's existing
 * payload shapes; ownership is enforced indirectly via the passport's session
 * scope (Phase 4 hardens this with a thread/session join check).
 */
threadsRoute.get('/:threadId/messages', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const sessionId = c.req.query('sessionId')
  if (!sessionId) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'sessionId query param is required' },
      },
      400
    )
  }

  try {
    const service = getChatService()
    const messages = await service.getMessages(sessionId)
    return c.json({ success: true, data: { messages, nextCursor: null } })
  } catch (error) {
    log.error('Failed to load chat history', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load history' } },
      500
    )
  }
})

export default threadsRoute
