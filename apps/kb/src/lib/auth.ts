// apps/kb/src/lib/auth.ts
// Authentication utilities for the public KB satellite app.

import { WEBAPP_URL } from '@auxx/config/urls'
import { createLocalSessionHelpers } from '@auxx/credentials/local-session'
import { getRedisClient } from '@auxx/redis'
import { cookies } from 'next/headers'

const helpers = createLocalSessionHelpers({
  cookieName: 'auxx-kb.session',
  secretEnv: 'KB_SESSION_SECRET',
  ttlSeconds: 24 * 60 * 60, // 24 hours
  getCookieStore: () => cookies(),
  getRedis: () => getRedisClient(),
})

export type Session = { userId: string; email: string }

export const KB_SESSION_COOKIE_NAME = 'auxx-kb.session'

export const createLocalSession = helpers.createSession
export const verifyLocalSession = helpers.verifySession
export const getLocalSession = helpers.getSession
export const consumeLoginTokenJti = helpers.consumeLoginTokenJti

/**
 * URL on the issuing web app where users land when they hit an INTERNAL KB
 * without a local KB session. The web app handles login + token issuance,
 * then bounces back to the KB's `/auth/verify` route.
 */
export function getLoginUrl(kbId: string, returnPath?: string): string {
  const params = new URLSearchParams({ kbId })
  if (returnPath) params.set('returnTo', returnPath)
  return `${WEBAPP_URL}/kb-auth?${params.toString()}`
}
