// packages/credentials/src/lambda-auth/callback-token.ts

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { CallbackScope } from './types'

const DEFAULT_TTL_MS = 60_000

/** Optional claim keys accepted after the 5 fixed fields. Order is not significant; each may appear at most once. */
const OPTIONAL_CLAIM_KEYS = ['c', 'u'] as const
type OptionalClaimKey = (typeof OPTIONAL_CLAIM_KEYS)[number]

/**
 * Create a scoped callback token for Lambda SDK → API authentication.
 *
 * Token format:
 *   base64url(<scope>:<installationId>:<organizationId>:<expMs>:<nonce>[:c=<connectionId>][:u=<userId>].<hmacHex>)
 *
 * The first 5 fields are fixed and positional; anything after is a `k=v`
 * optional claim, keyed rather than positional so a token can carry any
 * subset without the parser guessing which optional field is present.
 * `c` (agent-bound connection) is minted only for the `entities` scope; `u`
 * (the signed-in user) only when a real user invoked the call — see
 * `prepare-lambda-context.ts`. IDs contain no colons or `=`, so this stays
 * unambiguous.
 *
 * Domain prefix "callback:v1:" prevents cross-purpose reuse with inbound signatures.
 * Scope field prevents a token issued for /webhooks from being replayed on /settings.
 */
export function createCallbackToken(params: {
  installationId: string
  organizationId: string
  scope: CallbackScope
  secret: string
  ttlMs?: number
  /** Agent-bound connection id, signed into the token for the `entities` scope. */
  connectionId?: string
  /** The invoking user's id. Never sign in a sentinel like `'system'` — the caller omits this field instead. */
  userId?: string
}): string {
  const {
    installationId,
    organizationId,
    scope,
    secret,
    ttlMs = DEFAULT_TTL_MS,
    connectionId,
    userId,
  } = params
  const exp = Date.now() + ttlMs
  const nonce = randomUUID()
  const claims = [`${scope}:${installationId}:${organizationId}:${exp}:${nonce}`]
  if (connectionId) claims.push(`c=${connectionId}`)
  if (userId) claims.push(`u=${userId}`)
  const data = claims.join(':')
  const mac = createHmac('sha256', secret).update(`callback:v1:${data}`).digest('hex')
  return Buffer.from(`${data}.${mac}`).toString('base64url')
}

/**
 * Verify a scoped callback token.
 *
 * Checks signature (constant-time), scope, installation ID, and expiry.
 */
export function verifyCallbackToken(params: {
  token: string
  expectedInstallationId: string
  expectedScope: CallbackScope
  secret: string
}): {
  valid: boolean
  organizationId?: string
  connectionId?: string
  userId?: string
  error?: string
} {
  try {
    const decoded = Buffer.from(params.token, 'base64url').toString()
    const lastDot = decoded.lastIndexOf('.')
    if (lastDot === -1) return { valid: false, error: 'Malformed token' }

    const data = decoded.slice(0, lastDot)
    const mac = decoded.slice(lastDot + 1)

    // Constant-time signature verification
    const expected = createHmac('sha256', params.secret).update(`callback:v1:${data}`).digest('hex')
    if (
      mac.length !== expected.length ||
      !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
    ) {
      return { valid: false, error: 'Invalid token signature' }
    }

    // 5 fixed fields, then any number of keyed optional claims.
    const parts = data.split(':')
    if (parts.length < 5) {
      return { valid: false, error: 'Malformed token payload' }
    }
    const [scope, installationId, organizationId, expStr] = parts

    const claims: Partial<Record<OptionalClaimKey, string>> = {}
    for (const claim of parts.slice(5)) {
      const eq = claim.indexOf('=')
      if (eq === -1) return { valid: false, error: 'Malformed token payload' }
      const key = claim.slice(0, eq)
      if (!OPTIONAL_CLAIM_KEYS.includes(key as OptionalClaimKey)) {
        return { valid: false, error: 'Malformed token payload' }
      }
      if (key in claims) return { valid: false, error: 'Malformed token payload' }
      claims[key as OptionalClaimKey] = claim.slice(eq + 1)
    }

    if (scope !== params.expectedScope) {
      return {
        valid: false,
        error: `Scope mismatch: expected "${params.expectedScope}", got "${scope}"`,
      }
    }
    if (installationId !== params.expectedInstallationId) {
      return { valid: false, error: 'Installation ID mismatch' }
    }
    if (Number(expStr) < Date.now()) {
      return { valid: false, error: 'Token expired' }
    }

    return { valid: true, organizationId, connectionId: claims.c, userId: claims.u }
  } catch {
    return { valid: false, error: 'Malformed token' }
  }
}
