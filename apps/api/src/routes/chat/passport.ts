// apps/api/src/routes/chat/passport.ts

import { randomUUID } from 'node:crypto'
import { issueChatPassport } from '@auxx/credentials/passport'
import { database } from '@auxx/database'
import { findOrCreateVisitorParticipant } from '@auxx/lib/chat-widget/visitor'
import { RedisRateLimiter } from '@auxx/lib/utils/rate-limiter'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import {
  applyChatCorsHeaders,
  hostnameFromHeader,
  isHostAllowed,
  loadChatWidgetByChannelId,
} from './lib'

const log = createScopedLogger('chat-passport-route')

const passportRoute = new Hono()

/** Per-IP passport issuance rate limit. Same shape as workflow-share's limiter. */
const passportIssuanceLimiter = new RedisRateLimiter({
  name: 'chat-passport-issue:ip',
  maxRequests: 10,
  perInterval: 60_000,
})

const CHAT_SESSION_COOKIE = 'auxx_chat_session_id'

passportRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/passport
 *
 * Body: `{ channelId: string, visitorId?: string }`
 *
 * Validates the request origin against the widget's `allowedDomains`,
 * resolves (or creates) a visitor Participant, then mints a chat-scoped
 * JWT passport. CORS headers echo the validated origin.
 */
passportRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  c.header('Cache-Control', 'no-store')

  const clientIp =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'

  const allowed = await passportIssuanceLimiter.acquire(`issue:ip:${clientIp}`)
  if (!allowed) {
    return c.json(
      { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      429
    )
  }

  let body: { channelId?: string; visitorId?: string } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'Body must be JSON' } },
      400
    )
  }

  const channelId = body.channelId
  if (!channelId) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'channelId is required' } },
      400
    )
  }

  const widget = await loadChatWidgetByChannelId(channelId)
  if (!widget) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Chat widget not found' } },
      404
    )
  }
  if (!widget.isActive || !widget.integrationEnabled) {
    return c.json(
      { success: false, error: { code: 'WIDGET_INACTIVE', message: 'Chat widget is inactive' } },
      403
    )
  }

  // Origin allowlist
  if (widget.allowedDomains.length > 0) {
    const host =
      hostnameFromHeader(c.req.header('origin')) ?? hostnameFromHeader(c.req.header('referer'))
    if (!isHostAllowed(widget.allowedDomains, host)) {
      log.warn('Passport issuance blocked by origin allowlist', {
        channelId,
        host,
        allowed: widget.allowedDomains,
      })
      return c.json(
        {
          success: false,
          error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed' },
        },
        403
      )
    }
  }

  // Resolve sticky session cookie (visitorId override takes precedence for resume)
  let sessionId = body.visitorId || getCookie(c, CHAT_SESSION_COOKIE)
  if (!sessionId) sessionId = randomUUID()

  const participantResult = await findOrCreateVisitorParticipant({
    db: database,
    organizationId: widget.organizationId,
    sessionId,
  })
  if (participantResult.error) {
    log.error('Failed to resolve visitor participant', {
      channelId,
      error: participantResult.error.message,
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve visitor' } },
      500
    )
  }
  const participant = participantResult.value

  const issued = await issueChatPassport({
    visitorParticipantId: participant.id,
    channelId,
    organizationId: widget.organizationId,
    sessionId,
    expiresIn: '1h',
  })
  if (issued.isErr()) {
    log.error('Failed to issue chat passport', { channelId, error: issued.error.message })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to issue passport' } },
      500
    )
  }

  setCookie(c, CHAT_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Cross-site embed: cookie travels with `credentials: 'include'` from any host
    sameSite: 'None',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })

  return c.json({
    success: true,
    data: {
      passport: issued.value.token,
      visitorId: participant.identifier,
      visitorParticipantId: participant.id,
      expiresIn: issued.value.expiresIn,
    },
  })
})

export default passportRoute
