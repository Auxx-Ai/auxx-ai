// apps/api/src/routes/installations.ts

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { requireScope } from '../middleware/scope'
import { errorResponse, type ErrorStatusCode } from '../lib/response'
import type { AppContext } from '../types/context'

// Service imports
// import { verifyAppAccess } from '../services/developer-accounts'
import { verifyAppAccess } from '@auxx/services/developer-accounts'
import { getDevInstallation } from '@auxx/services/app-installations'

const installations = new Hono<AppContext>()

installations.use('/*', authMiddleware)

/**
 * Error code to HTTP status code mapping
 */
const ERROR_STATUS_MAP: Record<string, ErrorStatusCode> = {
  APP_NOT_FOUND: 404,
  ACCESS_DENIED: 403,
  INSTALLATION_NOT_FOUND: 404,
  DATABASE_ERROR: 500,
}

/**
 * GET /api/v1/apps/:appId/organization/:organizationId/dev-installation
 * Check if an app has a development installation in an organization
 */
installations.get(
  '/:appId/organization/:organizationId/dev-installation',
  requireScope(['developer', 'apps:read']),
  async (c) => {
    const appId = c.req.param('appId')
    const organizationId = c.req.param('organizationId')
    const userId = c.get('userId')

    // Step 1: Verify app access
    const accessResult = await verifyAppAccess({ appId, userId })
    if (accessResult.isErr()) {
      const error = accessResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse(error.code, error.message), statusCode)
    }

    // Step 2: Get installation
    const installationResult = await getDevInstallation({ appId, organizationId })
    if (installationResult.isErr()) {
      const error = installationResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse(error.code, error.message), statusCode)
    }

    return c.json({
      appId: installationResult.value.appId,
      organizationId: installationResult.value.organizationId,
    })
  }
)

export default installations
