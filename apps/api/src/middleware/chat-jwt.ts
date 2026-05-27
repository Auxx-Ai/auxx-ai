// apps/api/src/middleware/chat-jwt.ts

import { hashChatUserJwt, type VerifiedChatUserJwt, verifyChannelUserJwt } from '@auxx/lib/chat'
import { createScopedLogger } from '@auxx/logger'
import type { MiddlewareHandler } from 'hono'

const log = createScopedLogger('chat-jwt-middleware')

export type ChatJwtState =
  | { verified: true; claims: VerifiedChatUserJwt; hashMatchesPassport: boolean | null }
  | { verified: false; reason: 'absent' | 'unverified' }

declare module 'hono' {
  interface ContextVariableMap {
    chatJwt: ChatJwtState
  }
}

/**
 * Re-verify the customer-signed JWT carried in `user_data.auxx_user_jwt`
 * on every chat request after the passport middleware has run.
 *
 * Phase 3/4 wrote `c.var.chatJwt` and warn-logged on failure but never
 * rejected. Phase 5 layers enforcement on top: when the channel's
 * `identityVerification === 'enforced'` (baked into the passport at mint
 * time), missing/invalid JWTs on write requests return 401 instead.
 *
 * GET/HEAD have no body — they pass through. Customers should sign
 * attribute-bearing POST/PUT calls; pure reads carry only the passport.
 */
export const chatUserJwtMiddleware: MiddlewareHandler = async (c, next) => {
  const passport = c.var.chat
  if (!passport) {
    // chat-passport middleware should have run before this; if it didn't, the
    // route is misconfigured. Don't try to verify anything here.
    c.set('chatJwt', { verified: false, reason: 'absent' })
    return next()
  }

  const enforced = passport.identityVerification === 'enforced'
  const rejectEnforced = (code: 'IDENTITY_REQUIRED', message: string) =>
    c.json({ success: false, error: { code, message } }, 401)

  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    c.set('chatJwt', { verified: false, reason: 'absent' })
    return next()
  }

  // Only JSON bodies carry the user_data envelope. Reading any other
  // content type (e.g. application/x-www-form-urlencoded from
  // /pusher/auth) would consume the stream before the route handler can
  // parse it, breaking the downstream handler.
  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    c.set('chatJwt', { verified: false, reason: 'absent' })
    if (enforced) {
      log.warn('Chat request rejected — enforced channel, non-JSON body', {
        channelId: passport.channelId,
        contentType,
      })
      return rejectEnforced('IDENTITY_REQUIRED', 'This chat channel requires a signed user JWT')
    }
    return next()
  }

  let body: unknown = null
  try {
    body = await c.req.json()
  } catch {
    // Empty / malformed JSON — treat as absent.
    c.set('chatJwt', { verified: false, reason: 'absent' })
    if (enforced) {
      log.warn('Chat request rejected — enforced channel, no JWT body', {
        channelId: passport.channelId,
      })
      return rejectEnforced('IDENTITY_REQUIRED', 'This chat channel requires a signed user JWT')
    }
    return next()
  }

  const userData = (body as { user_data?: unknown })?.user_data
  const tokenRaw =
    userData && typeof userData === 'object'
      ? (userData as { auxx_user_jwt?: unknown }).auxx_user_jwt
      : undefined
  const token = typeof tokenRaw === 'string' && tokenRaw.length > 0 ? tokenRaw : null

  if (!token) {
    c.set('chatJwt', { verified: false, reason: 'absent' })
    if (enforced) {
      log.warn('Chat request rejected — enforced channel, no JWT in user_data', {
        channelId: passport.channelId,
      })
      return rejectEnforced('IDENTITY_REQUIRED', 'This chat channel requires a signed user JWT')
    }
    return next()
  }

  const result = await verifyChannelUserJwt(passport.channelId, passport.organizationId, token)
  if (result.isErr()) {
    log.warn('Chat user JWT verification failed (per-request)', {
      channelId: passport.channelId,
      code: result.error.code,
    })
    c.set('chatJwt', { verified: false, reason: 'unverified' })
    if (enforced) {
      return rejectEnforced(
        'IDENTITY_REQUIRED',
        'This chat channel requires a valid signed user JWT'
      )
    }
    return next()
  }

  // Compare against the passport-bound hash so phase 5 can reject a
  // mid-session swap. v4 records the comparison but doesn't act on it.
  const passportHash = passport.userJwtHash
  const currentHash = result.value.hash
  const hashMatchesPassport =
    typeof passportHash === 'string'
      ? passportHash === currentHash
      : // No hash on passport — usually means the mint happened pre-JWT or
        // the customer added a JWT after boot. Treat as "no comparison made".
        null

  if (hashMatchesPassport === false) {
    log.warn('Per-request JWT hash differs from passport-bound hash', {
      channelId: passport.channelId,
      currentHash: hashChatUserJwt(token),
    })
  }

  c.set('chatJwt', { verified: true, claims: result.value, hashMatchesPassport })
  return next()
}
