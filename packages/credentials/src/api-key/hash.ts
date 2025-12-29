// packages/credentials/src/api-key/hash.ts

import { scryptSync } from 'node:crypto'

/**
 * Hash an API key using scrypt
 * Uses API_KEY_SALT from environment for consistent hashing
 *
 * @param apiKey - The raw API key to hash
 * @returns Hashed API key in format "salt:hash"
 */
export function hashApiKey(apiKey: string): string {
  const salt = process.env.API_KEY_SALT
  if (!salt) throw new Error('API_KEY_SALT is not set')

  const derivedKey = scryptSync(apiKey, salt, 64)
  return `${salt}:${derivedKey.toString('hex')}`
}
