// packages/lib/src/cache/csrf.ts

import { getTokenCache } from './index'

const CSRF_KEY_PREFIX = 'oauth_csrf'

/**
 * Stores an OAuth CSRF token, keyed by userId.
 * Token expires after 10 minutes (TokenCacheService default TTL).
 */
export async function storeOAuthCsrfToken(userId: string, token: string): Promise<void> {
  await getTokenCache().store(`${CSRF_KEY_PREFIX}:${userId}`, token)
}

/**
 * Retrieves and deletes (one-time use) an OAuth CSRF token.
 * Returns the token if found, or null if missing/expired.
 */
export async function consumeOAuthCsrfToken(userId: string): Promise<string | null> {
  return getTokenCache().consume(`${CSRF_KEY_PREFIX}:${userId}`)
}
