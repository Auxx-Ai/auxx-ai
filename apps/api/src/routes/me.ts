// apps/api/src/routes/me.ts

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { successResponse, errorResponse, ERROR_STATUS_MAP } from '../lib/response'
import type { AppContext } from '../types/context'
import { getMe } from '@auxx/services/users'

/** Router handling /api/v1/me endpoints */
const me = new Hono<AppContext>()

// All routes require authentication
me.use('/*', authMiddleware)

/**
 * GET /api/v1/me
 * Returns the authenticated user with memberships and organizations
 */
me.get('/', async (c) => {
  const userId = c.get('userId')

  const result = await getMe({ userId })

  if (result.isErr()) {
    const error = result.error
    const status = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message), status)
  }

  return c.json(successResponse({ me: result.value }))
})

export default me
