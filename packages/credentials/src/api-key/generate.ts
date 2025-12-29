// packages/credentials/src/api-key/generate.ts

import { randomBytes } from 'node:crypto'

/**
 * Generate a cryptographically secure random token
 * Used for creating new API keys
 *
 * @returns Base64-encoded random token
 */
export function generateSecureToken(): string {
  return randomBytes(32).toString('base64')
}

/**
 * Generate a prefixed API key
 * Format: "<prefix>_<base64url token>"
 *
 * @param prefix - Optional prefix (default: 'auxx')
 * @returns Prefixed API key
 */
export function generateApiKey(prefix: string = 'auxx'): string {
  const token = randomBytes(32).toString('base64url')
  return `${prefix}_${token}`
}
