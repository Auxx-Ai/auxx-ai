// apps/api/src/middleware/chat-jwt.ts

import { getOrgCache } from '@auxx/lib/cache'
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
 * v4 phase 9: reads the live `(chatAudience, identityVerification)` from the
 * channel cache rather than the baked passport — flipping policy in the
 * dashboard takes effect on the next request instead of waiting for the
 * passport TTL.
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

  // Live channel policy — never trust the passport-baked enforcement state.
  const channels = await getOrgCache().get(passport.organizationId, 'channels')
  const channel = channels.find((ch) => ch.id === passport.channelId)
  const audience = (channel?.chatWidget?.chatAudience ?? 'visitors') as
    | 'visitors'
    | 'both'
    | 'users'
  const rollout = (channel?.chatWidget?.identityVerification ?? 'off') as
    | 'off'
    | 'in_progress'
    | 'enforced'

  // `visitors` audience skips the JWT path entirely — any token in the body
  // is ignored, no key lookup, no verify.
  if (audience === 'visitors') {
    c.set('chatJwt', { verified: false, reason: 'absent' })
    return next()
  }

  // Write-time enforcement applies when the channel rolled out to `enforced`
  // and the audience expects a JWT. `both + enforced` rejects an invalid JWT
  // when sent but lets anonymous traffic through. `users + enforced` rejects
  // missing/invalid JWTs unconditionally.
  const enforced = rollout === 'enforced'
  const usersOnlyEnforced = enforced && audience === 'users'
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
    if (usersOnlyEnforced) {
      log.warn('Chat request rejected — users-only enforced channel, non-JSON body', {
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
    if (usersOnlyEnforced) {
      log.warn('Chat request rejected — users-only enforced channel, no JWT body', {
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
    if (usersOnlyEnforced) {
      log.warn('Chat request rejected — users-only enforced channel, no JWT in user_data', {
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
    // `both + enforced` and `users + enforced` both reject invalid JWTs when
    // sent — the matrix only differs in how they treat *absent* tokens.
    if (enforced) {
      return rejectEnforced(
        'IDENTITY_REQUIRED',
        'This chat channel requires a valid signed user JWT'
      )
    }
    return next()
  }

  // Identity rotation guard. If the passport was minted under user A but the
  // request now carries a JWT for user B, the host app rotated identity
  // without first calling `Auxx.logout()` or `Auxx.boot()`. Reject so a
  // stale passport's `contactId` cannot be used to read or write under a
  // different user — the transport layer retries once after force-minting
  // a fresh passport, which makes this transparent to well-behaved callers.
  //
  // Anonymous → identified upgrade (passport has no jwtUserId) is *not* a
  // mismatch — let it through. The passport will be re-minted with the
  // verified identity on the next mint cycle.
  if (passport.jwtUserId && passport.jwtUserId !== result.value.userId) {
    log.warn('Chat request rejected — JWT identity does not match the active passport', {
      channelId: passport.channelId,
      passportUserId: passport.jwtUserId,
      requestUserId: result.value.userId,
    })
    return c.json(
      {
        success: false,
        error: {
          code: 'IDENTITY_MISMATCH',
          message:
            'JWT identity does not match the active session. Call Auxx.logout() or Auxx.boot() with the new user before sending requests as a different identity.',
        },
      },
      401
    )
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
