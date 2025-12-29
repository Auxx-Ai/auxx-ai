// apps/api/src/routes/organizations/index.ts

import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth'
import { organizationMiddleware } from '../../middleware/organization'
import apps from './apps'
import bundles from './bundles'
import executeServerFunction from './execute-server-function'
import type { AppContext } from '../../types/context'

const organizations = new Hono<AppContext>()

// All organization routes require authentication
organizations.use('/*', authMiddleware)

// All routes under /:handle require organization membership verification
organizations.use('/:handle/*', organizationMiddleware)

// Mount sub-routers
organizations.route('/:handle/apps', apps)
organizations.route('/:handle', bundles) // Bundle download routes
organizations.route('/:handle', executeServerFunction) // Server function execution

// Future routes:
// organizations.route('/:handle/settings', settings)
// organizations.route('/:handle/members', members)
// organizations.route('/:handle/webhooks', webhooks)

export default organizations
