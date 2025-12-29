// apps/api/src/middleware/scope.ts

import { createMiddleware } from 'hono/factory'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

/**
 * Scope authorization middleware
 * Checks if user has required scopes
 *
 * @param requiredScopes - Array of scopes that user must have (OR logic)
 * @example
 * // User must have 'developer' OR 'apps:read' scope
 * app.get('/apps', requireScope(['developer', 'apps:read']), (c) => { ... })
 */
export function requireScope(requiredScopes: string[]) {
  return createMiddleware<AppContext>(async (c, next) => {
    const userScopes = c.get('scopes') || []

    const hasRequiredScope = requiredScopes.some((required) => userScopes.includes(required))

    if (!hasRequiredScope) {
      return c.json(
        errorResponse(
          'FORBIDDEN',
          `Missing required scope. Need one of: ${requiredScopes.join(', ')}`
        ),
        403
      )
    }

    await next()
  })
}

/**
 * Require ALL specified scopes (AND logic)
 */
export function requireAllScopes(requiredScopes: string[]) {
  return createMiddleware<AppContext>(async (c, next) => {
    const userScopes = c.get('scopes') || []

    const hasAllScopes = requiredScopes.every((required) => userScopes.includes(required))

    if (!hasAllScopes) {
      return c.json(
        errorResponse(
          'FORBIDDEN',
          `Missing required scopes. Need all of: ${requiredScopes.join(', ')}`
        ),
        403
      )
    }

    await next()
  })
}
