// apps/api/src/routes/chat/passport.ts

import { randomUUID } from 'node:crypto'
import { issueChatPassport } from '@auxx/credentials/passport'
import { database, schema } from '@auxx/database'
import { resolveChatAttributes, verifyChannelUserJwt } from '@auxx/lib/chat'
import { findOrCreateVisitorParticipant } from '@auxx/lib/chat-widget/visitor'
import { type GeoLocation, lookupIp } from '@auxx/lib/geo'
import { findOrCreateContactFromJwt } from '@auxx/lib/ingest'
import { RedisRateLimiter } from '@auxx/lib/utils/rate-limiter'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { parseIdentifyPayload } from './identify'
import {
  applyChatCorsHeaders,
  hostnameFromHeader,
  isHostAllowed,
  loadChatWidgetByChannelId,
} from './lib'

/**
 * Resolve the best human-readable label for a JWT-verified visitor's
 * Participant. Priority: raw `name` claim > `first_name + last_name` >
 * `first_name` > email. Returns `null` when none of those are usable so
 * callers leave the existing label in place.
 */
function deriveVisitorDisplayName(opts: {
  rawName?: string
  firstName?: string
  lastName?: string
  email?: string
}): string | null {
  const raw = opts.rawName?.trim()
  if (raw) return raw
  const first = opts.firstName?.trim()
  const last = opts.lastName?.trim()
  if (first || last) return [first, last].filter(Boolean).join(' ').trim() || null
  const email = opts.email?.trim()
  if (email) return email
  return null
}

/** Pull the customer-signed JWT out of the request body's `user_data` envelope. */
function extractUserJwt(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const userData = (body as { user_data?: unknown }).user_data
  if (!userData || typeof userData !== 'object') return null
  const token = (userData as { auxx_user_jwt?: unknown }).auxx_user_jwt
  return typeof token === 'string' && token.length > 0 ? token : null
}

/**
 * Pull the non-sensitive `Auxx.boot({ attributes })` bag out of the
 * `user_data` envelope. Phase 4 merges these with verified JWT claims via
 * `resolveChatAttributes` — JWT wins on same-key conflict.
 */
function extractBootAttributes(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined
  const userData = (body as { user_data?: unknown }).user_data
  if (!userData || typeof userData !== 'object') return undefined
  const attrs = (userData as { attributes?: unknown }).attributes
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return undefined
  return attrs as Record<string, unknown>
}

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

passportRoute.options('/reset', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/passport/reset
 *
 * Dev/preview-only convenience to wipe the visitor's sticky session. Clears
 * the `auxx_chat_session_id` cookie by setting `Max-Age=0`. After this the
 * next passport request will allocate a brand-new sessionId + Participant.
 *
 * Not gated to dev because (a) it only affects the caller's own cookie and
 * (b) Pusher channel names are unguessable, so worst-case a malicious caller
 * just resets *themselves*.
 */
passportRoute.post('/reset', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  setCookie(c, CHAT_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
    maxAge: 0,
    path: '/',
  })
  return c.json({ success: true })
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

  let body: {
    channelId?: string
    visitorId?: string
    identify?: unknown
    user_data?: unknown
  } = {}
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

  // Mint-time IP geo lookup. Used to (a) seed the friendly visitor handle
  // ("Cyan Turtle from Inglewood") when the Participant is first created,
  // (b) write city/region/country/timezone to the Contact on the verified
  // path, and (c) populate Thread.metadata.visit downstream via the
  // passport stash. Failures here never block mint.
  const visitorIp = clientIp !== 'unknown' ? clientIp : undefined
  let geo: GeoLocation | null = null
  if (visitorIp) {
    try {
      geo = await lookupIp(visitorIp)
    } catch (error) {
      log.warn('Geo lookup failed', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const participantResult = await findOrCreateVisitorParticipant({
    db: database,
    organizationId: widget.organizationId,
    sessionId,
    geo,
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

  const identify = parseIdentifyPayload(body.identify) ?? undefined

  // v4 phase 3 — JWT identity verification on mint. The customer's server
  // signs an HS256 JWT with one of the channel's active
  // `ApiKey.encryptedSecret` rows; we verify, resolve (or create) the
  // Contact, and bake the result into the passport. Failures emit
  // `logger.warn` only — enforcement is gated to phase 5.
  let identityVerified = false
  let contactId: string | undefined
  let userJwtHash: string | undefined
  let jwtUserId: string | undefined
  let identityResolution: 'matched_external_id' | 'matched_email' | 'created' | undefined

  const userJwt = extractUserJwt(body)
  const bootAttributes = extractBootAttributes(body)

  // v4 phase 9 — branch on (audience, rollout):
  //  - `visitors`: short-circuit. No key lookup, no verify, JWT ignored.
  //  - `users + enforced`: mint itself requires a valid JWT.
  //  - `both + enforced` / others: verify when present, do not reject on
  //    absence (the per-request middleware handles the write-time gate for
  //    `both + enforced`).
  const audience = widget.chatAudience
  const rollout = widget.identityVerification
  const skipJwtPath = audience === 'visitors'
  const requireJwtAtMint = audience === 'users' && rollout === 'enforced'

  if (requireJwtAtMint && !userJwt) {
    log.warn('Chat passport mint rejected — users-only enforced channel, no JWT', {
      channelId,
    })
    return c.json(
      {
        success: false,
        error: {
          code: 'IDENTITY_REQUIRED',
          message: 'This chat channel requires a signed user JWT',
        },
      },
      401
    )
  }

  if (!skipJwtPath && userJwt) {
    const verified = await verifyChannelUserJwt(channelId, widget.organizationId, userJwt)
    if (verified.isErr()) {
      log.warn('Chat user JWT verification failed', {
        channelId,
        code: verified.error.code,
        message: verified.error.message,
      })
      if (requireJwtAtMint) {
        return c.json(
          {
            success: false,
            error: {
              code: 'IDENTITY_REQUIRED',
              message: 'This chat channel requires a valid signed user JWT',
            },
          },
          401
        )
      }
    } else {
      const claims = verified.value
      const { writes } = resolveChatAttributes({
        jwtClaims: claims.attributes,
        serverAttributes: geo
          ? {
              city: geo.city,
              region: geo.region,
              country: geo.country,
              timezone: geo.timezone,
            }
          : undefined,
        bootAttributes,
      })
      try {
        const resolved = await findOrCreateContactFromJwt({
          organizationId: widget.organizationId,
          userId: claims.userId,
          email: claims.email,
          attributes: writes,
        })
        identityVerified = true
        contactId = resolved.contactId
        userJwtHash = claims.hash
        jwtUserId = claims.userId
        identityResolution = resolved.resolution
        log.info('Chat user JWT verified', {
          channelId,
          resolution: resolved.resolution,
          contactId: resolved.contactId,
        })

        // Link the cookie-keyed visitor Participant to the verified Contact's
        // EntityInstance, and overwrite the synthetic `Chat user #xxxx`
        // displayName with the verified identity so message headers / thread
        // lists stop showing the placeholder. Done in one UPDATE.
        const displayName = deriveVisitorDisplayName({
          rawName: typeof claims.attributes.name === 'string' ? claims.attributes.name : undefined,
          firstName: typeof writes.first_name === 'string' ? writes.first_name : undefined,
          lastName: typeof writes.last_name === 'string' ? writes.last_name : undefined,
          email: claims.email,
        })
        const participantUpdates: Record<string, unknown> = { updatedAt: new Date() }
        // Verified JWT wins: a Shopify-signed customer identity is higher-trust
        // than any prior link (e.g. a stale OTP link), and a different
        // `jwtUserId` is a different person who must not inherit the old link.
        // Always overwrite so the issued passport's `contactId` and the
        // Participant link can never diverge. (Anonymous/OTP linking — which
        // only fills an empty `entityInstanceId` — lives outside this
        // verified-JWT branch.)
        if (participant.entityInstanceId !== resolved.contactId) {
          participantUpdates.entityInstanceId = resolved.contactId
        }
        if (displayName) {
          participantUpdates.name = displayName
          participantUpdates.displayName = displayName
        }
        if (Object.keys(participantUpdates).length > 1) {
          await database
            .update(schema.Participant)
            .set(participantUpdates)
            .where(eq(schema.Participant.id, participant.id))
        }
      } catch (error) {
        const e = error as Error & { cause?: unknown; code?: string }
        const cause = e.cause as Error | undefined
        log.error('Chat contact resolution from JWT failed', {
          channelId,
          userId: claims.userId,
          email: claims.email,
          attributes: writes,
          error: e.message,
          code: e.code,
          causeMessage: cause?.message,
          causeStack: cause?.stack,
          stack: e.stack,
        })
      }
    }
  }

  const issued = await issueChatPassport({
    visitorParticipantId: participant.id,
    channelId,
    organizationId: widget.organizationId,
    sessionId,
    identify,
    expiresIn: '1h',
    ...(identityVerified ? { identityVerified, contactId, jwtUserId, userJwtHash } : {}),
    identityVerification: widget.identityVerification,
    ...(geo
      ? {
          geo: {
            ...(geo.city ? { city: geo.city } : {}),
            ...(geo.region ? { region: geo.region } : {}),
            ...(geo.country ? { country: geo.country } : {}),
            ...(geo.countryCode ? { countryCode: geo.countryCode } : {}),
            ...(geo.timezone ? { timezone: geo.timezone } : {}),
          },
        }
      : {}),
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
      // Identity outcome echoed back for in-app surfaces (preview page,
      // future admin debug tools). Visitor clients ignore these fields.
      identityVerified,
      ...(contactId ? { contactId } : {}),
      ...(identityResolution ? { resolution: identityResolution } : {}),
    },
  })
})

export default passportRoute
