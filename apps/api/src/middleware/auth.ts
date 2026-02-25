// apps/api/src/middleware/auth.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { DEV_USER_ID, isDevelopment } from '../config'
import { extractBearerToken, validateBetterAuthToken } from '../lib/jwt-validator'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

/**
 * Development mode authentication bypass
 * Loads a hardcoded user from the database and attaches to context
 */
async function handleDevAuth(c: any, next: any) {
  if (!DEV_USER_ID) {
    return null
  }

  // Load dev user from database
  const users = await database
    .select()
    .from(schema.User)
    .where(eq(schema.User.email, DEV_USER_ID))
    .limit(1)

  const user = users[0]

  if (!user) {
    return c.json(
      errorResponse(
        'DEV_CONFIG_ERROR',
        `Development user not found: ${DEV_USER_ID}. Please set DEV_USER_ID to a valid user ID in your .env file.`
      ),
      500
    )
  }

  // Attach to context with developer scope
  c.set('userId', user.id)
  c.set('user', user)
  c.set('scopes', ['developer', 'apps:read', 'apps:write'])
  c.set('token', {
    userId: user.id,
    email: user.email,
    scopes: ['developer', 'apps:read', 'apps:write'],
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  })

  await next()
  return true
}

/**
 * Authentication middleware
 * Validates JWT token and loads user from database
 * Attaches user and token data to context
 */
export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
  // Try development auth first
  if (isDevelopment) {
    const handled = await handleDevAuth(c, next)
    if (handled) return
  }

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
