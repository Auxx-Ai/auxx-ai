// apps/api/src/routes/organizations/index.ts

import { verifyOrganizationAccess } from '@auxx/services/organizations'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import { authMiddleware } from '../../middleware/auth'
import { organizationMiddleware } from '../../middleware/organization'
import type { AppContext } from '../../types/context'
import apps from './apps'
import bundles from './bundles'
import executeServerFunction from './execute-server-function'
import records from './records'
import resources from './resources'

const organizations = new Hono<AppContext>()

/**
 * SDK callback-token principal for the record and schema reads
 * (plans/apps/outbound/01-records-api.md §2-4). Runs BEFORE `authMiddleware`
 * below, which doesn't understand a callback token; falls through to
 * `next()` when there's no `X-App-Installation-Id` header, so every other
 * request takes the normal session/OAuth path unchanged.
 */
const callbackTokenPrincipal = createMiddleware<AppContext>(async (c, next) => {
  if (!c.req.header('X-App-Installation-Id')) return next()

  const auth = verifyCallbackAuth(c, 'entities')
  if (!auth) return c.json(errorResponse('UNAUTHORIZED', 'Invalid callback token'), 401)
  if (!auth.userId) {
    return c.json(
      errorResponse('UNAUTHORIZED', 'This route requires a user-bound callback token'),
      401
    )
  }
  const handle = c.req.param('handle')
  if (!handle) return c.json(errorResponse('BAD_REQUEST', 'Organization handle required'), 400)
  // The token's `organizationId` is a trusted, signed claim (the tenant
  // boundary — see prepare-lambda-context.ts); cross-check it against the
  // org the URL's `:handle` resolves to, or a token minted for org A could
  // be replayed against any handle its user happens to also belong to.
  const access = await verifyOrganizationAccess({ handle, userId: auth.userId })
  if (access.isErr() || access.value.organization.id !== auth.organizationId) {
    return c.json(errorResponse('UNAUTHORIZED', 'Organization mismatch'), 401)
  }
  c.set('userId', auth.userId)
  c.set('organizationId', access.value.organization.id)
  c.set('organization', access.value.organization)
  return next()
})

organizations.use('/:handle/records/*', callbackTokenPrincipal)
organizations.use('/:handle/resources', callbackTokenPrincipal)
organizations.use('/:handle/resources/*', callbackTokenPrincipal)

// All organization routes require authentication
organizations.use('/*', authMiddleware)

// All routes under /:handle require organization membership verification
organizations.use('/:handle/*', organizationMiddleware)

// Mount sub-routers
organizations.route('/:handle/apps', apps)
organizations.route('/:handle', bundles) // Bundle download routes
organizations.route('/:handle', executeServerFunction) // Server function execution
organizations.route('/:handle', records) // Whole-record reads (plans/apps/outbound/01-records-api.md)
organizations.route('/:handle', resources) // Schema reads (same plan, §4)

// Future routes:
// organizations.route('/:handle/settings', settings)
// organizations.route('/:handle/members', members)
// organizations.route('/:handle/webhooks', webhooks)

export default organizations
