// apps/api/src/routes/workflows/run/index.ts

/**
 * API routes for programmatic workflow execution
 * Authentication via API key (no shareToken required)
 */

import { Hono } from 'hono'
import parametersRoute from './parameters'
import executeRoute from './execute'

const runRoutes = new Hono()

// GET /api/v1/workflows/run/parameters - get input schema
runRoutes.route('/parameters', parametersRoute)

// POST /api/v1/workflows/run - execute workflow
runRoutes.route('/', executeRoute)

export default runRoutes
