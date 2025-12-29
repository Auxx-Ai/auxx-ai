// apps/api/src/routes/workflows/share/index.ts

/**
 * Shared workflow routes for web-based access (no authentication required)
 * API access uses /api/v1/workflows/run instead
 */

import { Hono } from 'hono'
import passportRoute from './passport'
import siteRoute from './site'
import runsRoute from './runs'
import authStatusRoute from './auth-status'

const shareRoutes = new Hono()

// Mount share routes for web access
// GET/POST /api/v1/workflows/share/:shareToken/passport
shareRoutes.route('/:shareToken/passport', passportRoute)

// GET /api/v1/workflows/share/:shareToken/site
shareRoutes.route('/:shareToken/site', siteRoute)

// GET /api/v1/workflows/share/:shareToken/runs/:runId
shareRoutes.route('/:shareToken/runs', runsRoute)

// GET /api/v1/workflows/share/:shareToken/auth-status
shareRoutes.route('/:shareToken/auth-status', authStatusRoute)

export default shareRoutes
