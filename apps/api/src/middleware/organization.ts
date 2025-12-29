// apps/api/src/middleware/organization.ts

import { createMiddleware } from 'hono/factory'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'
import { verifyOrganizationAccess } from '@auxx/services/organizations'

/**
 * Organization middleware
 * - Extracts :handle from URL params
 * - Validates organization exists and is not disabled
 * - Verifies user is a member
 * - Attaches organization context to request
 *
 * Must run AFTER authMiddleware
 */
export const organizationMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const userId = c.get('userId')
  const handle = c.req.param('handle')

  if (!handle) {
    return c.json(errorResponse('BAD_REQUEST', 'Organization handle is required'), 400)
  }

  // Verify organization access using service
  const accessResult = await verifyOrganizationAccess({ handle, userId })

  if (accessResult.isErr()) {
    const error = accessResult.error

    switch (error.code) {
      case 'ORG_NOT_FOUND':
        return c.json(errorResponse('ORG_NOT_FOUND', error.message), 404)
      case 'ORG_DISABLED':
        return c.json(errorResponse('ORG_DISABLED', error.message), 410)
      case 'ORG_ACCESS_DENIED':
        return c.json(errorResponse('ORG_ACCESS_DENIED', error.message), 403)
      case 'DATABASE_ERROR':
        return c.json(errorResponse('INTERNAL_ERROR', 'Database error occurred'), 500)
      default:
        return c.json(errorResponse('INTERNAL_ERROR', 'An error occurred'), 500)
    }
  }

  const { organization, member } = accessResult.value

  // Attach to context
  c.set('organizationId', organization.id)
  c.set('organization', organization)
  c.set('organizationMember', member)
  c.set('organizationRole', member.role)

  await next()
})
