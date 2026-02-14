// apps/api/src/routes/workflows/index.ts

/**
 * Workflow routes
 */

import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth'
import { organizationMiddleware } from '../../middleware/organization'
import type { AppContext } from '../../types/context'
import executeWorkflowBlock from './execute-workflow-block'
import publicWorkflows from './public'
import runRoutes from './run'
import shareRoutes from './share'

const workflows = new Hono<AppContext>()

// Public routes (no auth) - must be mounted BEFORE auth middleware
// GET /api/v1/workflows/public/:id - public workflow viewer
workflows.route('/', publicWorkflows)

// Share routes (no auth) - web-based workflow sharing
// /api/v1/workflows/share/:shareToken/...
workflows.route('/share', shareRoutes)

// API run routes (API key auth) - programmatic workflow execution
// GET /api/v1/workflows/run/parameters
// POST /api/v1/workflows/run
workflows.route('/run', runRoutes)

// All other workflow routes require authentication
workflows.use('/:workflowId/*', authMiddleware)

// Workflow block execution requires organization context
workflows.use('/:workflowId/*', organizationMiddleware)

// Mount workflow block execution route
workflows.route('/', executeWorkflowBlock)

export default workflows
