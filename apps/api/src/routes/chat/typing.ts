// apps/api/src/routes/chat/typing.ts

import { publishChatTyping } from '@auxx/lib/chat'
import { getRealtimeService } from '@auxx/lib/realtime'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const typingRoute = new Hono()

typingRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/typing
 * Body: `{ threadId: string, isTyping: boolean }`
 */
typingRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const body = (await c.req.json().catch(() => ({}))) as {
    threadId?: string
    isTyping?: boolean
  }
  if (!body.threadId || typeof body.isTyping !== 'boolean') {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'threadId + isTyping are required' },
      },
      400
    )
  }

  await publishChatTyping(getRealtimeService(), {
    visitorChatSessionId: body.threadId,
    sender: 'USER',
    isTyping: body.isTyping,
  })
  return c.json({ success: true, data: {} })
})

export default typingRoute
