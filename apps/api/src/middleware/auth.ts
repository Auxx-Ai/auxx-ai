// apps/api/src/middleware/auth.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { extractBearerToken, validateBetterAuthToken } from '../lib/jwt-validator'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

/**
 * Authentication middleware
 * Validates OAuth2 access token via better-auth userinfo endpoint
 * Attaches user and token data to context
 */
export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const token = extractBearerToken(authHeader)

  if (!token) {
    return c.json(errorResponse('UNAUTHORIZED', 'Missing authentication token'), 401)
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

  // Load user from database
  const users = await database.select().from(schema.User).where(eq(schema.User.id, userId)).limit(1)

  const user = users[0]

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
