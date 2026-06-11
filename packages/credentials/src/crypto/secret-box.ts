// packages/credentials/src/crypto/secret-box.ts

import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { configService } from '../config/config-service'

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

/**
 * Decrypt a payload produced by encryptSecrets, or — for not-yet-backfilled
 * rows — a legacy-format payload (routed by the absence of the `v2:` prefix).
 */
export function decryptSecrets<T = Record<string, unknown>>(payload: string): T {
  if (!isV2Payload(payload)) {
    return decryptLegacySecrets<T>(payload)
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

/**
 * Decrypt the pre-v2 format (16-byte IV, optional auth tag, key = first 32
 * utf-8 chars of WORKFLOW_CREDENTIAL_ENCRYPTION_KEY). Exists ONLY for the
 * phase-3 backfill and not-yet-backfilled rows — deleted in phase 6.
 */
export function decryptLegacySecrets<T = Record<string, unknown>>(payload: string): T {
  try {
    const legacyKey = configService.get<string>('WORKFLOW_CREDENTIAL_ENCRYPTION_KEY')
    if (!legacyKey) {
      throw new Error('WORKFLOW_CREDENTIAL_ENCRYPTION_KEY is required to decrypt legacy secrets')
    }

    const combined = Buffer.from(payload, 'base64')
    const iv = combined.subarray(0, 16)
    const authTag = combined.subarray(16, 32)
    const ciphertext = combined.subarray(32)

    const decipher = crypto.createDecipheriv(ALGORITHM, legacyKey.substring(0, 32), iv)
    if (authTag.length > 0) {
      decipher.setAuthTag(authTag)
    }

    let decrypted = decipher.update(ciphertext, undefined, 'utf8')
    decrypted += decipher.final('utf8')
    return JSON.parse(decrypted) as T
  } catch (error) {
    if (error instanceof Error && error.message.includes('WORKFLOW_CREDENTIAL_ENCRYPTION_KEY')) {
      throw error
    }
    logger.error('Failed to decrypt legacy credential secrets')
    throw new Error('Failed to decrypt credential secrets')
  }
}
