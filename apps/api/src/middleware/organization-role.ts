// apps/api/src/middleware/organization-role.ts

import { createMiddleware } from 'hono/factory'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

/**
 * Require specific organization role(s)
 * Must run AFTER organizationMiddleware
 *
 * @param allowedRoles - Array of allowed roles (e.g., ['ADMIN', 'OWNER'])
 * @example
 * // Only admins and owners can install apps
 * app.post('/install', requireOrganizationRole(['ADMIN', 'OWNER']), (c) => { ... })
 */
export function requireOrganizationRole(allowedRoles: string[]) {
  return createMiddleware<AppContext>(async (c, next) => {
    const role = c.get('organizationRole')

    if (!allowedRoles.includes(role)) {
      return c.json(
        errorResponse(
          'ORG_ROLE_INSUFFICIENT',
          `This action requires one of the following roles: ${allowedRoles.join(', ')}`
        ),
        403
      )
    }

    await next()
  })
}
