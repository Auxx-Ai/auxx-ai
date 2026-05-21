// apps/api/src/routes/chat/visitor-info.ts

import { issueChatPassport } from '@auxx/credentials/passport'
import { database } from '@auxx/database'
import { patchChatThreadMetadata } from '@auxx/lib/chat'
import { createScopedLogger } from '@auxx/logger'
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
    await patchChatThreadMetadata(
      { db: database, organizationId: chat.organizationId },
      body.threadId,
      {
        claimedVisitorName,
        claimedVisitorEmail,
        claimedExternalId,
      }
    )

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
