// apps/api/src/routes/chat/pusher-auth.ts

import { database, schema } from '@auxx/database'
import { getRealtimeService } from '@auxx/lib/realtime'
import type { ChatThreadMetadata } from '@auxx/lib/threads/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
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
 * Two private channel families are gated here:
 *
 *   - `private-visitor-<visitorParticipantId>` — matches the visitor's
 *     participant id encoded in the passport. Cross-thread fanout.
 *   - `private-thread-<threadId>` — matches a thread whose
 *     `metadata.visitorParticipantId` equals the passport's visitor. Carries
 *     thread lifecycle events (taken_over, returned_to_ai, archived, …) that
 *     the widget renders as centered system lines.
 *
 * The existing public `chat-<id>` channels (message broadcast) remain
 * unauthenticated and untouched.
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

  const expectedVisitor = `private-visitor-${chat.visitorParticipantId}`
  let allowed = channelName === expectedVisitor

  if (!allowed && channelName.startsWith('private-thread-')) {
    const threadId = channelName.slice('private-thread-'.length)
    allowed = await visitorOwnsThread({
      threadId,
      organizationId: chat.organizationId,
      visitorParticipantId: chat.visitorParticipantId,
    })
  }

  if (!allowed) {
    log.warn('Rejected pusher auth — channel does not match passport visitor', {
      channelName,
      expectedVisitor,
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

/**
 * ACL helper: a visitor can subscribe to `private-thread-{threadId}` only when
 * the thread's `metadata.visitorParticipantId` matches their passport. The org
 * scope is enforced via the same query so a leaked passport from one org can
 * never authorize a sibling-org thread channel.
 */
async function visitorOwnsThread(args: {
  threadId: string
  organizationId: string
  visitorParticipantId: string
}): Promise<boolean> {
  const [row] = await database
    .select({ metadata: schema.Thread.metadata })
    .from(schema.Thread)
    .where(
      and(
        eq(schema.Thread.id, args.threadId),
        eq(schema.Thread.organizationId, args.organizationId)
      )
    )
    .limit(1)
  if (!row) return false
  const meta = (row.metadata ?? {}) as Partial<ChatThreadMetadata>
  return meta.channel === 'chat' && meta.visitorParticipantId === args.visitorParticipantId
}

export default pusherAuthRoute
