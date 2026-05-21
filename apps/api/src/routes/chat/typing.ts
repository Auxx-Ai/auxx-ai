// apps/api/src/routes/chat/typing.ts

import { Hono } from 'hono'
import { applyChatCorsHeaders, getChatService } from './lib'

const typingRoute = new Hono()

typingRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/typing
 * Body: `{ sessionId: string, isTyping: boolean }`
 */
typingRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const body = (await c.req.json().catch(() => ({}))) as {
    sessionId?: string
    isTyping?: boolean
  }
  if (!body.sessionId || typeof body.isTyping !== 'boolean') {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'sessionId + isTyping are required' },
      },
      400
    )
  }

  await getChatService().setUserTyping(body.sessionId, body.isTyping)
  return c.json({ success: true, data: {} })
})

export default typingRoute
