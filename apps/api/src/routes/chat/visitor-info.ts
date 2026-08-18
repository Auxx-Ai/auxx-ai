// apps/api/src/routes/chat/visitor-info.ts

import { issueChatPassport } from '@auxx/credentials/passport'
import { database, schema } from '@auxx/database'
import { patchChatThreadMetadata, updateVisitorClaimedIdentity } from '@auxx/lib/chat'
import { publisher } from '@auxx/lib/events'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { parseIdentifyPayload } from './identify'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-visitor-info-route')

const visitorInfoRoute = new Hono()

visitorInfoRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * PATCH /api/chat/visitor-info
 * Body: `{ threadId, visitorName?, visitorEmail?, identify? }`
 *
 * Updates the claimed visitor identity on the thread's chat metadata and
 * re-issues the passport so the new `identify` claim is carried on subsequent
 * requests. Returns the refreshed passport when `identify` is present.
 */
visitorInfoRoute.patch('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const body = (await c.req.json().catch(() => ({}))) as {
    threadId?: string
    visitorName?: string
    visitorEmail?: string
    identify?: unknown
  }
  if (!body.threadId) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'threadId is required' } },
      400
    )
  }

  const identify = parseIdentifyPayload(body.identify)
  const claimedVisitorName = identify?.name ?? body.visitorName
  const claimedVisitorEmail = identify?.email ?? body.visitorEmail
  const claimedExternalId = identify?.externalId

  try {
    const ctx = { db: database, organizationId: chat.organizationId }
    await patchChatThreadMetadata(ctx, body.threadId, {
      claimedVisitorName,
      claimedVisitorEmail,
      claimedExternalId,
    })

    // Overwrite the synthetic `Chat user #xxxx` displayName so message FROM
    // and future thread subjects pick up the real identity. The thread's inbox
    // routes the resulting `participant:updated` to the right lens channels.
    const thread = await database.query.Thread.findFirst({
      where: and(
        eq(schema.Thread.id, body.threadId),
        eq(schema.Thread.organizationId, chat.organizationId)
      ),
      columns: { inboxId: true },
    })
    await updateVisitorClaimedIdentity(ctx, chat.visitorParticipantId, {
      name: claimedVisitorName,
      email: claimedVisitorEmail,
      inboxId: thread?.inboxId ?? null,
    })

    // Emit `thread:visitor:identified` once an email is attached to an active
    // thread — admin + widget render this as a centered system line. Fired
    // only when we have an email (the spec keys the event on visitorEmail);
    // anonymous name-only updates don't qualify.
    if (claimedVisitorEmail) {
      await publisher.publishLater({
        type: 'thread:visitor:identified',
        data: {
          threadId: body.threadId,
          organizationId: chat.organizationId,
          visitorEmail: claimedVisitorEmail,
          participantId: chat.visitorParticipantId,
        },
      })
    }

    let passport: { token: string; expiresIn: string } | undefined
    if (identify) {
      const issued = await issueChatPassport({
        visitorParticipantId: chat.visitorParticipantId,
        channelId: chat.channelId,
        organizationId: chat.organizationId,
        sessionId: chat.sessionId,
        identify,
      })
      if (issued.isOk()) {
        passport = { token: issued.value.token, expiresIn: issued.value.expiresIn }
      } else {
        log.warn('Failed to re-issue chat passport with identify claim', {
          threadId: body.threadId,
          error: issued.error.message,
        })
      }
    }

    return c.json({ success: true, data: passport ? { passport } : {} })
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
