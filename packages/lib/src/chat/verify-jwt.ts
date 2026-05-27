// packages/lib/src/chat/verify-jwt.ts

import { createHash } from 'node:crypto'
import { CredentialService } from '@auxx/credentials'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { jwtVerify } from 'jose'
import { err, ok, type Result } from 'neverthrow'
import { recordChatJwtSuccess } from './jwt-success-counter'

const log = createScopedLogger('chat-verify-jwt')

/**
 * Failure modes returned by {@link verifyChannelUserJwt}. The route layer
 * decides whether to 401 (when the channel is enforced) or `logger.warn`
 * (warn-only) — this helper never throws and never decides policy itself.
 */
export type ChatJwtError =
  | { code: 'NO_ACTIVE_KEYS'; message: string }
  | { code: 'INVALID_SIGNATURE'; message: string }
  | { code: 'EXPIRED'; message: string }
  | { code: 'MISSING_CLAIM'; message: string }
  | { code: 'MALFORMED'; message: string }

/**
 * Claims promoted out of a verified chat user JWT. Reserved fields
 * (`user_id`, `email`, `exp`) are pulled to the top level; everything
 * else from the customer's payload lands in `attributes` for phase 4
 * to resolve against the boot-time `attributes` bag.
 */
export interface VerifiedChatUserJwt {
  /** Customer-chosen stable identifier (any string) — becomes `chat:<userId>`. */
  userId: string
  /** Optional signed email for email-fold contact resolution. */
  email?: string
  /** Seconds-epoch expiry from the JWT — re-checked per request downstream. */
  exp: number
  /** Stable SHA-256 of the raw token; used to correlate per-request verification. */
  hash: string
  /** Everything in the JWT beyond reserved claims (user_id, email, exp, iat). */
  attributes: Record<string, unknown>
}

/**
 * Verify an HS256 JWT minted by a customer using one of the channel's
 * active signing secrets.
 *
 * Phase-2 stores chat-key secrets AES-256-GCM-encrypted in
 * `ApiKey.encryptedSecret`. This helper loads every active row for
 * `(organizationId, type='chat', referenceId=channelId)`, decrypts each,
 * and tries `jose.jwtVerify` until one matches. A 30s clock-skew
 * tolerance absorbs minor drift between the customer's server and ours.
 *
 * The lookup is unscoped on `userId` — phase 2 admin checks already
 * ensure only admins create chat keys, and JWT verification is intrinsically
 * tied to the channel (`referenceId`) rather than the issuing user.
 */
export async function verifyChannelUserJwt(
  channelId: string,
  organizationId: string,
  token: string
): Promise<Result<VerifiedChatUserJwt, ChatJwtError>> {
  const trimmed = token.trim()
  if (!trimmed) return err({ code: 'MALFORMED', message: 'Empty JWT' })

  const activeKeys = await database
    .select({ id: schema.ApiKey.id, encryptedSecret: schema.ApiKey.encryptedSecret })
    .from(schema.ApiKey)
    .where(
      and(
        eq(schema.ApiKey.organizationId, organizationId),
        eq(schema.ApiKey.type, 'chat'),
        eq(schema.ApiKey.referenceId, channelId),
        eq(schema.ApiKey.isActive, true)
      )
    )

  if (activeKeys.length === 0) {
    return err({ code: 'NO_ACTIVE_KEYS', message: 'No active signing keys for channel' })
  }

  const encoder = new TextEncoder()
  let lastError: ChatJwtError = {
    code: 'INVALID_SIGNATURE',
    message: 'No active signing key matched',
  }

  for (const row of activeKeys) {
    if (!row.encryptedSecret) {
      // Defensive: a chat key without an encryptedSecret cannot verify anything.
      // Older rows minted before the phase-2 storage swap would land here.
      log.warn('Chat ApiKey row missing encryptedSecret', { keyId: row.id, channelId })
      continue
    }

    let secret: string
    try {
      const decrypted = CredentialService.decrypt(row.encryptedSecret)
      const value = decrypted.value
      if (typeof value !== 'string' || !value) {
        log.warn('Chat ApiKey decrypted payload missing value', { keyId: row.id, channelId })
        continue
      }
      secret = value
    } catch (error) {
      log.error('Failed to decrypt chat ApiKey secret', {
        keyId: row.id,
        channelId,
        error: (error as Error).message,
      })
      continue
    }

    try {
      const { payload } = await jwtVerify(trimmed, encoder.encode(secret), {
        algorithms: ['HS256'],
        clockTolerance: 30,
      })

      const userId = typeof payload.user_id === 'string' ? payload.user_id : null
      const email = typeof payload.email === 'string' ? payload.email : undefined
      const exp = typeof payload.exp === 'number' ? payload.exp : null

      if (!userId) {
        lastError = { code: 'MISSING_CLAIM', message: 'JWT missing required user_id claim' }
        continue
      }
      if (!exp) {
        lastError = { code: 'MISSING_CLAIM', message: 'JWT missing required exp claim' }
        continue
      }

      const {
        user_id: _u,
        email: _e,
        exp: _x,
        iat: _i,
        ...rest
      } = payload as Record<string, unknown>

      // Best-effort counter bump for phase-5 enforcement safety rail.
      // Fire-and-forget — the verify result must not wait on Redis.
      void recordChatJwtSuccess(channelId)

      return ok({
        userId,
        email,
        exp,
        hash: createHash('sha256').update(trimmed).digest('hex'),
        attributes: rest,
      })
    } catch (error) {
      const message = (error as Error).message || 'unknown'
      if (message.includes('expired') || message.includes('"exp"')) {
        lastError = { code: 'EXPIRED', message: 'JWT expired' }
      } else if (message.includes('signature')) {
        lastError = { code: 'INVALID_SIGNATURE', message: 'JWT signature verification failed' }
      } else {
        lastError = { code: 'MALFORMED', message: `JWT verification failed: ${message}` }
      }
    }
  }

  return err(lastError)
}

/** SHA-256 the raw token; matches the `hash` field returned on successful verify. */
export function hashChatUserJwt(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex')
}
