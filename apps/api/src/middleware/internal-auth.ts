// apps/api/src/middleware/internal-auth.ts

import crypto from 'node:crypto'
import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { BETTER_AUTH_SECRET } from '../config'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

const MAX_AGE_MS = 30_000 // 30 seconds replay window

/**
 * Internal service authentication middleware.
 * Validates HMAC-signed requests from trusted internal services (e.g. Next.js server).
 *
 * Expected headers:
 * - Authorization: Internal <hmac_signature>
 * - X-Internal-User-Id: <userId>
 * - X-Internal-User-Email: <userEmail>
 * - X-Internal-User-Name: <userName> (optional)
 * - X-Internal-Timestamp: <unix_ms>
 *
 * HMAC payload: `${userId}:${userEmail}:${timestamp}`
 * HMAC algorithm: SHA-256 with BETTER_AUTH_SECRET
 */
export const internalAuthMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Internal ')) {
    return c.json(errorResponse('UNAUTHORIZED', 'Missing internal auth'), 401)
  }

  const signature = authHeader.slice('Internal '.length)
  const userId = c.req.header('X-Internal-User-Id')
  const userEmail = c.req.header('X-Internal-User-Email')
  const timestamp = c.req.header('X-Internal-Timestamp')

  if (!userId || !userEmail || !timestamp || !BETTER_AUTH_SECRET) {
    return c.json(errorResponse('UNAUTHORIZED', 'Invalid internal auth headers'), 401)
  }

  // Replay protection
  const age = Date.now() - Number(timestamp)
  if (age > MAX_AGE_MS || age < -5_000) {
    return c.json(errorResponse('UNAUTHORIZED', 'Expired internal auth'), 401)
  }

  // Verify HMAC
  const payload = `${userId}:${userEmail}:${timestamp}`
  const expected = crypto.createHmac('sha256', BETTER_AUTH_SECRET).update(payload).digest('hex')

  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return c.json(errorResponse('UNAUTHORIZED', 'Invalid internal auth signature'), 401)
  }

  // Load user from database
  const users = await database.select().from(schema.User).where(eq(schema.User.id, userId)).limit(1)
  const user = users[0]
  if (!user) {
    return c.json(errorResponse('UNAUTHORIZED', 'User not found'), 401)
  }

  c.set('userId', userId)
  c.set('user', user)
  c.set('scopes', [])
  c.set('token', { userId, email: userEmail, scopes: [], expiresAt: Date.now() + 30_000 })

  await next()
})
