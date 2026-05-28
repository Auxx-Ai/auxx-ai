// packages/lib/src/chat/sign-jwt.ts

import { SignJWT } from 'jose'

/**
 * Payload for {@link signChannelUserJwt}. Mirrors what
 * {@link verifyChannelUserJwt} expects: `user_id` is required, anything else
 * passes through to the JWT body and surfaces in `verified.attributes`.
 */
export interface SignChannelUserJwtPayload {
  /** Stable customer-side user id. Required. */
  user_id: string
  /** Optional signed email; enables the email-fold tier on contact resolve. */
  email?: string
  /** Convenience for visitor display name; verified consumers may pick it up. */
  name?: string
  /** Any additional sensitive claims the caller wants protected by the JWT. */
  [key: string]: unknown
}

export interface SignChannelUserJwtOptions {
  /** JWT lifetime. Accepts a jose duration string (e.g. `'1h'`). Default `'1h'`. */
  expiresIn?: string
}

/**
 * Sign an HS256 user JWT for a chat channel using the channel's signing
 * secret. The matching verifier is {@link verifyChannelUserJwt}; using a
 * shared module for both keeps the algorithm + claim shape in lockstep.
 *
 * Server-side entry point for internal mint paths (e.g. Shopify App Proxy).
 * The customer-facing npm package `@auxx/chat/server` exposes its own
 * `signUserJwt` for merchants signing on their own infrastructure — both
 * produce interchangeable tokens since the spec is just HS256 + payload.
 */
export async function signChannelUserJwt(
  payload: SignChannelUserJwtPayload,
  secret: string,
  options: SignChannelUserJwtOptions = {}
): Promise<string> {
  if (!payload || typeof payload.user_id !== 'string' || payload.user_id.length === 0) {
    throw new Error('signChannelUserJwt: payload.user_id is required')
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('signChannelUserJwt: secret is required')
  }

  const secretKey = new TextEncoder().encode(secret)
  const expiresIn = options.expiresIn ?? '1h'

  return await new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey)
}
