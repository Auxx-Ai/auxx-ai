// apps/api/src/routes/chat/pusher-auth.ts

import { getRealtimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-pusher-auth-route')

const pusherAuthRoute = new Hono()

pusherAuthRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/pusher/auth
 *
 * Pusher private-channel auth endpoint. Reads form-encoded `socket_id` and
 * `channel_name`, verifies the channel belongs to the visitor whose passport
 * authenticated the request, and signs the Pusher auth response.
 *
 * Only `private-visitor-<visitorParticipantId>` channels are gated here. The
 * existing per-thread `chat-<id>` channels remain public.
 */
pusherAuthRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
  const socketId = typeof form.socket_id === 'string' ? form.socket_id : null
  const channelName = typeof form.channel_name === 'string' ? form.channel_name : null

  if (!socketId || !channelName) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'socket_id and channel_name are required' },
      },
      400
    )
  }

  const expected = `private-visitor-${chat.visitorParticipantId}`
  if (channelName !== expected) {
    log.warn('Rejected pusher auth — channel does not match passport visitor', {
      channelName,
      expected,
    })
    return c.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Channel not allowed' } },
      403
    )
  }

  const auth = getRealtimeService().authenticateChannel(socketId, channelName)
  if (!auth) {
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Pusher auth unavailable' } },
      500
    )
  }
  return c.json(auth)
})

export default pusherAuthRoute
