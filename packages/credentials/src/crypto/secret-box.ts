// packages/credentials/src/crypto/secret-box.ts

import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { configService } from '../config/config-service'
import { isMasked } from './client'

const logger = createScopedLogger('credential-secret-box')

const ALGORITHM = 'aes-256-gcm'
const V2_PREFIX = 'v2:'
const IV_LENGTH = 12 // GCM standard
const AUTH_TAG_LENGTH = 16
const KEY_PATTERN = /^[0-9a-f]{64}$/i

const KEY_HINT = 'Generate one with: openssl rand -hex 32'

/**
 * Resolve and validate the 32-byte AES key from CREDENTIAL_ENCRYPTION_KEY.
 * Read lazily (never at module load) and never logged.
 */
function getKey(): Buffer {
  const key = configService.get<string>('CREDENTIAL_ENCRYPTION_KEY')
  if (!key || !KEY_PATTERN.test(key)) {
    throw new Error(`CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ${KEY_HINT}`)
  }
  return Buffer.from(key, 'hex')
}

/** True when the payload is in the versioned v2 format. */
export function isV2Payload(payload: string): boolean {
  return payload.startsWith(V2_PREFIX)
}

/**
 * Encrypt a secrets object to the versioned format:
 * `v2:` + base64(iv(12) ‖ authTag(16) ‖ ciphertext).
 */
export function encryptSecrets(secrets: Record<string, unknown>): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)

    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secrets), 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    const combined = Buffer.concat([iv, authTag, ciphertext])
    return V2_PREFIX + combined.toString('base64')
  } catch (error) {
    // Re-throw key-validation errors verbatim (they carry the generate hint).
    if (error instanceof Error && error.message.includes('CREDENTIAL_ENCRYPTION_KEY')) {
      throw error
    }
    logger.error('Failed to encrypt credential secrets')
    throw new Error('Failed to encrypt credential secrets')
  }
}

/** Fixed mask for short secrets — constant length so it never leaks that the secret is short. */
const FULL_MASK = '********'

/** Encrypt a single string value to the v2 format (wraps the object box). */
export function encryptValue(value: string): string {
  return encryptSecrets({ v: value })
}

/**
 * Decrypt a single string value produced by encryptValue.
 *
 * Lenient policy (ConnectionDefinition columns): non-`v2:` payloads are returned
 * unchanged so deploy-then-backfill ordering is safe and plaintext dev rows keep
 * working. Distinct from the strict `decryptSecrets`, which rejects them.
 */
export function decryptValue(payload: string | null): string | null {
  if (payload === null) return null
  if (!isV2Payload(payload)) return payload
  return decryptSecrets<{ v: string }>(payload).v
}

/**
 * Mask a secret for display: up to 4 chars revealed per side, with at least
 * 6 chars always hidden (`revealPerSide = min(4, floor((length - 6) / 2))`).
 * Secrets shorter than 10 chars return a fixed-length full mask.
 */
export function maskValue(value: string): string {
  const revealPerSide = Math.min(4, Math.floor((value.length - 6) / 2))
  if (revealPerSide < 2) return FULL_MASK
  const stars = '*'.repeat(Math.min(value.length - 2 * revealPerSide, 20))
  return value.slice(0, revealPerSide) + stars + value.slice(-revealPerSide)
}

/**
 * True when a submitted value is a client echoing a masked prefill back — the
 * `HIDDEN_VALUE` sentinel or a `maskValue`-shaped string. Never persist it.
 *
 * Alias of the client-safe `isMasked`; kept for existing server-side callers.
 */
export const isMaskEcho = isMasked

/** Decrypt a payload produced by encryptSecrets. */
export function decryptSecrets<T = Record<string, unknown>>(payload: string): T {
  if (!isV2Payload(payload)) {
    throw new Error('Unrecognized credential payload format (expected v2 prefix)')
  }

  try {
    const combined = Buffer.from(payload.slice(V2_PREFIX.length), 'base64')
    const iv = combined.subarray(0, IV_LENGTH)
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(decrypted.toString('utf8')) as T
  } catch (error) {
    if (error instanceof Error && error.message.includes('CREDENTIAL_ENCRYPTION_KEY')) {
      throw error
    }
    logger.error('Failed to decrypt credential secrets')
    throw new Error('Failed to decrypt credential secrets')
  }
}
