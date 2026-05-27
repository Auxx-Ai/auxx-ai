// packages/chat/src/server/index.ts

/**
 * Node-side helper for signing the user JWT that `@auxx/chat`'s browser
 * bootstrap accepts via `Auxx.boot({ userJwt })`.
 *
 * Customers sign HS256 tokens on their own server using a per-channel secret
 * stored in our `ApiKey` table (`type='chat'`, `referenceId=channelId`). The
 * widget forwards the token with every request to `/api/chat/*`; phase 3
 * wires verification on the server side.
 *
 * Default expiry is 1h. Tokens are short-lived; per-request re-verification
 * catches expiry — no denylist.
 */

import jwt, { type SignOptions } from 'jsonwebtoken'

export interface SignUserJwtPayload {
  /** Stable customer-side user id. Required. */
  user_id: string
  /** Optional identifying attributes — passed through to the contact merge. */
  email?: string
  name?: string
  /** Any additional sensitive claims the customer wants protected by JWT. */
  [key: string]: unknown
}

export interface SignUserJwtOptions {
  /** JWT lifetime. Accepts seconds (number) or a vercel-ms string. Default `'1h'`. */
  expiresIn?: SignOptions['expiresIn']
}

export function signUserJwt(
  payload: SignUserJwtPayload,
  secret: string,
  options: SignUserJwtOptions = {}
): string {
  if (!payload || typeof payload.user_id !== 'string' || payload.user_id.length === 0) {
    throw new Error('signUserJwt: payload.user_id is required')
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('signUserJwt: secret is required')
  }
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: options.expiresIn ?? '1h',
  })
}
