// apps/api/src/lib/session-validator.ts

import { getCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { BETTER_AUTH_SESSION_URL } from '../config'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('session-validator')

/**
 * Session data from better-auth
 */
export interface SessionData {
  userId: string
  email: string
  name: string | null
  defaultOrganizationId: string | null
}

/**
 * Validate better-auth session from cookies
 *
 * @param c - Hono context
 * @returns Session data if valid, null otherwise
 */
export async function validateSessionFromCookies(c: Context): Promise<SessionData | null> {
  // better-auth uses this cookie name
  const sessionToken = getCookie(c, 'better-auth.session_token')

  if (!sessionToken) {
    logger.debug('No session token cookie found')
    return null
  }

  try {
    // Call better-auth session endpoint with the session cookie
    const response = await fetch(BETTER_AUTH_SESSION_URL, {
      method: 'GET',
      headers: {
        Cookie: `better-auth.session_token=${sessionToken}`,
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      logger.debug('Session validation failed', { status: response.status })
      return null
    }

    const data = await response.json()

    // The webapp's /api/auth/session returns { session: { userId, userEmail, ... } }
    if (!data.session?.userId) {
      logger.debug('No user in session response')
      return null
    }

    const session = data.session

    return {
      userId: session.userId,
      email: session.userEmail,
      name: session.userName || null,
      defaultOrganizationId: null,
    }
  } catch (error) {
    logger.error('Session validation error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
