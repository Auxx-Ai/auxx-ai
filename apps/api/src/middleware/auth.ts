// apps/api/src/middleware/auth.ts

import { createMiddleware } from 'hono/factory'
import { extractBearerToken, validateBetterAuthToken } from '../lib/jwt-validator'
import { errorResponse } from '../lib/response'
import { getCachedUserRow } from '../lib/user-cache'
import type { AppContext } from '../types/context'
import { developerKeyAuth } from './developer-key-auth'
import { internalAuthMiddleware } from './internal-auth'

/**
 * Authentication middleware
 * Validates OAuth2 access token via better-auth userinfo endpoint
 * Attaches user and token data to context
 *
 * Also supports internal service auth (HMAC-signed requests from Next.js server)
 * via the `Authorization: Internal <signature>` scheme.
 */
export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  // Delegate to internal auth middleware for service-to-service calls
  if (authHeader?.startsWith('Internal ')) {
    return internalAuthMiddleware(c, next)
  }

  const token = extractBearerToken(authHeader)

  if (!token) {
    return c.json(errorResponse('UNAUTHORIZED', 'Missing authentication token'), 401)
  }

  // Developer API keys (headless CI publishing) — resolved by hash lookup, no
  // better-auth round-trip. Recognized by the `auxx_dev_` prefix.
  if (token.startsWith('auxx_dev_')) {
    return developerKeyAuth(c, next, token)
  }

  // Validate token with better-auth
  const validation = await validateBetterAuthToken(token)

  if (!validation.success) {
    const { error } = validation
    switch (error.code) {
      case 'INVALID_TOKEN':
        return c.json(errorResponse('UNAUTHORIZED', 'Invalid token'), 401)
      case 'TOKEN_EXPIRED':
        return c.json(errorResponse('UNAUTHORIZED', 'Token expired'), 401)
      case 'VALIDATION_FAILED':
        return c.json(errorResponse('UNAUTHORIZED', error.message), 401)
      default:
        return c.json(errorResponse('UNAUTHORIZED', 'Authentication failed'), 401)
    }
  }

  const { userId, scopes } = validation.data

  // Load user (5-minute in-memory cache — same staleness window as the token cache)
  const user = await getCachedUserRow(userId)

  if (!user) {
    return c.json(errorResponse('UNAUTHORIZED', 'User not found'), 401)
  }

  // Attach to context
  c.set('userId', userId)
  c.set('user', user)
  c.set('scopes', scopes)
  c.set('token', validation.data)

  await next()
})
