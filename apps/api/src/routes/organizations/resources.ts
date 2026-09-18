// apps/api/src/routes/organizations/resources.ts

import { getCapabilities } from '@auxx/lib/permissions'
import { getResourceFor, listResourcesFor } from '@auxx/lib/resources'
import { Hono } from 'hono'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

/**
 * The schema an app or API client can act on (plans/apps/outbound/01-records-api.md §4).
 * Principal is the user on the context — session, OAuth, or a user-bound callback token —
 * resolved by the same middleware chain as `/:handle/records/*`.
 */
const resources = new Hono<AppContext>()

resources.get('/resources', async (c) => {
  const capabilities = await getCapabilities(c.get('userId'), c.get('organizationId'))
  return c.json(await listResourcesFor(c.get('organizationId'), capabilities))
})

// A def the principal cannot see is 404, never 403 — same non-enumeration rule as records.
resources.get('/resources/:idOrSlug', async (c) => {
  const capabilities = await getCapabilities(c.get('userId'), c.get('organizationId'))
  const node = await getResourceFor(c.get('organizationId'), capabilities, c.req.param('idOrSlug'))
  if (!node) return c.json(errorResponse('NOT_FOUND', 'Resource not found'), 404)
  return c.json(node)
})

export default resources
