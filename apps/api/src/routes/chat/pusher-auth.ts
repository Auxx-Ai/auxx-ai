// apps/api/src/routes/chat/pusher-auth.ts

import { database, schema } from '@auxx/database'
import { buildVisitorThreadOwnership } from '@auxx/lib/chat'
import { getRealtimeService } from '@auxx/lib/realtime'
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
      contactId: chat.contactId,
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
 * the thread is owned by the caller — either by the caller's session-keyed
 * visitor Participant OR (when the passport carries a verified Contact) by
 * any Participant linked to the same Contact. The org scope is enforced in
 * the same query so a leaked passport from one org can never authorize a
 * sibling-org thread channel.
 */
async function visitorOwnsThread(args: {
  threadId: string
  organizationId: string
  visitorParticipantId: string
  contactId: string | undefined
}): Promise<boolean> {
  const ownership = buildVisitorThreadOwnership({
    db: database,
    visitorParticipantId: args.visitorParticipantId,
    contactId: args.contactId,
  })
  const [row] = await database
    .select({ id: schema.Thread.id })
    .from(schema.Thread)
    .where(
      and(
        eq(schema.Thread.id, args.threadId),
        eq(schema.Thread.organizationId, args.organizationId),
        ownership
      )
    )
    .limit(1)
  return !!row
}

export default pusherAuthRoute
