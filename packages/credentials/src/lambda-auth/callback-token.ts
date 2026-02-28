// packages/credentials/src/lambda-auth/callback-token.ts

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { CallbackScope } from './types'

const DEFAULT_TTL_MS = 60_000

/**
 * Create a scoped callback token for Lambda SDK → API authentication.
 *
 * Token format: base64url(<scope>:<installationId>:<organizationId>:<expMs>:<nonce>.<hmacHex>)
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
}): string {
  const { installationId, organizationId, scope, secret, ttlMs = DEFAULT_TTL_MS } = params
  const exp = Date.now() + ttlMs
  const nonce = randomUUID()
  const data = `${scope}:${installationId}:${organizationId}:${exp}:${nonce}`
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
}): { valid: boolean; organizationId?: string; error?: string } {
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

    // Parse claims
    const parts = data.split(':')
    if (parts.length !== 5) return { valid: false, error: 'Malformed token payload' }
    const [scope, installationId, organizationId, expStr] = parts

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

    return { valid: true, organizationId }
  } catch {
    return { valid: false, error: 'Malformed token' }
  }
}
