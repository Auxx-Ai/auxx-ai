// apps/api/src/routes/organizations/apps.ts

import { Hono } from 'hono'
import { requireOrganizationRole } from '../../middleware/organization-role'
import { successResponse, errorResponse, ERROR_STATUS_MAP } from '../../lib/response'
import type { AppContext } from '../../types/context'
import {
  getAvailableApps,
  getAppWithInstallationStatus,
  getAppVersions,
  installApp,
  uninstallApp,
  installAppRequestSchema,
  listAppsQuerySchema,
  listVersionsQuerySchema,
  listInstalledAppsQuerySchema,
  uninstallAppRequestSchema,
  listAppEventLogs,
} from '@auxx/services/apps'
import { getInstalledApps } from '@auxx/services/app-installations'
import { z } from 'zod'

const apps = new Hono<AppContext>()

/**
 * Console log entry from eventData.consoleLogs
 */
interface ConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  timestamp: number // Unix timestamp in milliseconds
}

/**
 * Flattened log event ready for SDK
 */
interface FlattenedLogEvent {
  id: string
  message: string
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
  timestamp: string
  metadata: {
    eventId: string
    eventType: string
    appVersionId: string | null
    userId: string | null
    requestMethod: string | null
    requestPath: string | null
    responseStatus: number | null
    durationMs: number | null
    consoleLogIndex: number
  }
}

/**
 * Flatten app event logs into individual console log entries
 * This matches the flattening logic from apps/build/src/app/(portal)/[slug]/apps/[app_slug]/logs/page.tsx
 */
function flattenAppEventLogs(
  appEventLogs: Array<{
    id: string
    appId: string
    organizationId: string
    appVersionId: string | null
    userId: string | null
    eventType: string
    eventData: any
    requestMethod: string | null
    requestPath: string | null
    responseStatus: number | null
    durationMs: number | null
    timestamp: Date
  }>
): FlattenedLogEvent[] {
  const flattened: FlattenedLogEvent[] = []

  for (const eventLog of appEventLogs) {
    const consoleLogs = (eventLog.eventData?.consoleLogs || []) as ConsoleLog[]

    for (let i = 0; i < consoleLogs.length; i++) {
      const log = consoleLogs[i]!

      // Map console.log level to severity
      const severity: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG' =
        log.level === 'error' ? 'ERROR' : log.level === 'warn' ? 'WARNING' : 'INFO'

      // Convert numeric timestamp to ISO 8601 string
      const timestamp = new Date(log.timestamp).toISOString()

      flattened.push({
        id: `${eventLog.id}-${i}`,
        message: log.message,
        severity,
        timestamp,
        metadata: {
          eventId: eventLog.id,
          eventType: eventLog.eventType,
          appVersionId: eventLog.appVersionId,
          userId: eventLog.userId,
          requestMethod: eventLog.requestMethod,
          requestPath: eventLog.requestPath,
          responseStatus: eventLog.responseStatus,
          durationMs: eventLog.durationMs,
          consoleLogIndex: i,
        },
      })
    }
  }

  // Sort by timestamp (ascending - oldest first)
  flattened.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return flattened
}

/**
 * Get the newest timestamp from flattened logs
 */
function getNewestTimestamp(logs: FlattenedLogEvent[]): string | null {
  if (logs.length === 0) return null
  // Since logs are sorted ascending, the last one is newest
  return logs[logs.length - 1]!.timestamp
}

/**
 * Query schema for logs endpoint
 */
const getLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(300).optional(),
})

/**
 * GET /api/v1/organizations/:handle/apps
 * List all apps available to this organization (includes private dev apps and public marketplace apps)
 */
apps.get('/', async (c) => {
  const organizationId = c.get('organizationId')

  // Parse and validate query parameters
  const queryResult = listAppsQuerySchema.safeParse(c.req.query())

  if (!queryResult.success) {
    return c.json(
      errorResponse('BAD_REQUEST', 'Invalid query parameters', queryResult.error.issues),
      400
    )
  }

  const { category, search, limit, offset } = queryResult.data

  // Get available apps
  const result = await getAvailableApps({
    organizationId,
    filters: {
      category,
      searchQuery: search,
    },
    pagination: {
      limit,
      offset,
    },
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  return c.json(successResponse(result.value))
})

/**
 * GET /api/v1/organizations/:handle/apps/installed
 * List all apps that have been installed by this organization
 */
apps.get('/installed', async (c) => {
  const organizationId = c.get('organizationId')

  // Parse and validate query parameters
  const queryResult = listInstalledAppsQuerySchema.safeParse(c.req.query())

  if (!queryResult.success) {
    return c.json(
      errorResponse('BAD_REQUEST', 'Invalid query parameters', queryResult.error.issues),
      400
    )
  }

  const { type: installationType } = queryResult.data

  // Get installed apps
  const result = await getInstalledApps({
    organizationId,
    filters: installationType ? { installationType } : undefined,
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  return c.json(successResponse(result.value))
})

/**
 * GET /api/v1/organizations/:handle/apps/:appSlug
 * Get app details with installation status
 */
apps.get('/:appSlug', async (c) => {
  const appSlug = c.req.param('appSlug')
  const organizationId = c.get('organizationId')

  // Get app details with installation status
  const result = await getAppWithInstallationStatus({
    appSlug,
    organizationId,
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  return c.json(successResponse(result.value))
})

/**
 * POST /api/v1/organizations/:handle/apps/:appSlug/install
 * Install an app
 */
apps.post('/:appSlug/install', requireOrganizationRole(['ADMIN', 'OWNER']), async (c) => {
  const appSlug = c.req.param('appSlug')
  const organizationId = c.get('organizationId')
  const userId = c.get('userId')

  // Parse and validate request body
  const body = await c.req.json()
  const bodyResult = installAppRequestSchema.safeParse(body)

  if (!bodyResult.success) {
    return c.json(
      errorResponse('BAD_REQUEST', 'Invalid request body', bodyResult.error.issues),
      400
    )
  }

  const { type, versionId } = bodyResult.data

  // Install app
  const result = await installApp({
    appSlug,
    organizationId,
    installationType: type!,
    versionId,
    installedById: userId,
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  return c.json(successResponse(result.value), 201)
})

/**
 * DELETE /api/v1/organizations/:handle/apps/:appSlug/uninstall
 * Uninstall an app
 */
apps.delete('/:appSlug/uninstall', requireOrganizationRole(['ADMIN', 'OWNER']), async (c) => {
  const appSlug = c.req.param('appSlug')
  const organizationId = c.get('organizationId')
  const userId = c.get('userId')

  // Parse and validate query parameters
  const queryResult = uninstallAppRequestSchema.safeParse(c.req.query())

  if (!queryResult.success) {
    return c.json(
      errorResponse('BAD_REQUEST', 'Invalid query parameters', queryResult.error.issues),
      400
    )
  }

  const { type: installationType } = queryResult.data

  // Uninstall app
  const result = await uninstallApp({
    appSlug,
    organizationId,
    uninstalledById: userId,
    installationType,
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  return c.json(successResponse(result.value))
})

/**
 * GET /api/v1/organizations/:handle/apps/:appSlug/versions
 * List available versions for app
 */
apps.get('/:appSlug/versions', async (c) => {
  const appSlug = c.req.param('appSlug')
  const organizationId = c.get('organizationId')

  // Parse and validate query parameters
  const queryResult = listVersionsQuerySchema.safeParse(c.req.query())

  if (!queryResult.success) {
    return c.json(
      errorResponse('BAD_REQUEST', 'Invalid query parameters', queryResult.error.issues),
      400
    )
  }

  const { type, status } = queryResult.data

  // Get app versions
  const result = await getAppVersions({
    appSlug,
    organizationId,
    filters: {
      versionType: type,
      status,
    },
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  return c.json(successResponse(result.value))
})

/**
 * POST /api/v1/organizations/:handle/apps/:appSlug/rollback
 * Rollback to previous version
 *
 * TODO: Implement service to rollback app version
 */
// apps.post('/:appSlug/rollback', requireOrganizationRole(['ADMIN', 'OWNER']), async (c) => {
//   const appSlug = c.req.param('appSlug')
//   const organizationId = c.get('organizationId')

//   // TODO: Call service to rollback app version
//   // const result = await rollbackAppVersion({ appSlug, organizationId })

//   return c.json(
//     successResponse({
//       message: 'TODO: Implement rollbackAppVersion service',
//       appSlug,
//       organizationId,
//     })
//   )
// })

/**
 * GET /api/v1/organizations/:handle/apps/:appSlug/logs
 * Get flattened app console logs with cursor-based pagination
 */
apps.get('/:appSlug/logs', async (c) => {
  const appSlug = c.req.param('appSlug')
  const organizationId = c.get('organizationId')
  const organizationHandle = c.req.param('handle')

  // Parse and validate query parameters
  const queryResult = getLogsQuerySchema.safeParse(c.req.query())

  if (!queryResult.success) {
    return c.json(
      errorResponse('BAD_REQUEST', 'Invalid query parameters', queryResult.error.issues),
      400
    )
  }

  const { cursor, limit = 100 } = queryResult.data

  // First, get app to verify it exists and get appId
  const appResult = await getAppWithInstallationStatus({
    appSlug,
    organizationId,
  })

  if (appResult.isErr()) {
    const error = appResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  const app = appResult.value.app

  // Get app event logs using existing service
  // If cursor is provided, use it as startTimestamp to get newer logs (for streaming)
  // Otherwise, use cursor for descending pagination (for historical logs)
  const logsResult = await listAppEventLogs({
    appId: app.id,
    organizationSlug: organizationHandle!,
    startTimestamp: cursor ? new Date(cursor) : undefined,
    limit,
  })

  if (logsResult.isErr()) {
    const error = logsResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message, error), statusCode)
  }

  const { appEventLogs, hasMore, nextCursor } = logsResult.value

  // Flatten the logs
  const flattenedLogs = flattenAppEventLogs(appEventLogs)

  // Return flattened logs with cursor info
  return c.json(
    successResponse({
      logs: flattenedLogs,
      hasMore,
      nextCursor,
      newestTimestamp: getNewestTimestamp(flattenedLogs),
    })
  )
})

export default apps
