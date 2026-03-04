// apps/api/src/routes/settings.ts

/**
 * @fileoverview App settings management routes for Auxx.ai apps.
 * Provides endpoints for getting and setting app settings from Lambda runtime.
 * These settings are defined by app developers and persisted per app installation.
 *
 * @module routes/settings
 */

import { database } from '@auxx/database'
import { getAppSettings, saveAppSettings, setAppSetting } from '@auxx/services/app-settings'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../lib/callback-auth'
import { ERROR_STATUS_MAP, errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

/**
 * Hono router instance for settings management.
 * All routes require X-App-Installation-Id header for authentication.
 *
 * @type {Hono<AppContext>}
 */
const settings = new Hono<AppContext>()

/**
 * Schema for saving multiple settings.
 * Validates the request body for POST /apps/settings endpoint.
 *
 * @typedef {Object} SaveSettingsRequest
 * @property {Record<string, any>} settings - Key-value pairs of settings to save
 *
 * @example
 * {
 *   "settings": {
 *     "apiKey": "sk_abc123",
 *     "maxRetries": 5,
 *     "enableLogging": true
 *   }
 * }
 */
const saveSettingsSchema = z.object({
  settings: z.record(z.string(), z.any()),
})

/**
 * Schema for setting a single setting value.
 * Validates the request body for PUT /apps/settings/:key endpoint.
 *
 * @typedef {Object} SetSettingRequest
 * @property {any} value - The value to set for the setting
 *
 * @example
 * {
 *   "value": "sk_new_api_key_456"
 * }
 */
const setSettingSchema = z.object({
  value: z.any(),
})

/**
 * Gets all settings for an app installation.
 * Returns all settings merged with schema defaults.
 *
 * @route GET /api/v1/sdk/settings
 * @access Protected - Requires X-App-Installation-Id header
 *
 * @param {Object} c - Hono context object
 * @param {Function} c.req.header - Function to get request headers
 * @param {Function} c.json - Function to return JSON response
 *
 * @returns {Promise<Response>} JSON response with settings object or error
 *
 * @example Request Headers
 * {
 *   "X-App-Installation-Id": "app_install_abc123xyz"
 * }
 *
 * @example Success Response (200)
 * {
 *   "success": true,
 *   "data": {
 *     "apiKey": "sk_abc123",
 *     "maxRetries": 5,
 *     "enableLogging": true
 *   }
 * }
 *
 * @example Error Response - Unauthorized (401)
 * {
 *   "success": false,
 *   "error": {
 *     "code": "UNAUTHORIZED",
 *     "message": "App installation ID required"
 *   }
 * }
 *
 * @throws {UnauthorizedError} When X-App-Installation-Id header is missing
 * @throws {InternalError} When database operation fails
 */
settings.get('/', async (c) => {
  try {
    const auth = verifyCallbackAuth(c, 'settings')
    if (!auth) return c.res

    // Load installation with current deployment for settings schema
    const installation = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, auth.installationId),
      columns: {
        id: true,
        currentDeploymentId: true,
      },
      with: {
        currentDeployment: {
          columns: {
            settingsSchema: true,
          },
        },
      },
    })

    if (!installation) {
      return c.json(errorResponse('NOT_FOUND', 'Installation not found'), 404)
    }

    // Extract organization schema from deployment
    const settingsSchemaObj = installation.currentDeployment?.settingsSchema as {
      organization?: any
    } | null
    const schema = settingsSchemaObj?.organization

    // Get settings with schema for default merging
    const result = await getAppSettings({
      appInstallationId: auth.installationId,
      schema,
    })

    if (result.isErr()) {
      const status = ERROR_STATUS_MAP[result.error.code] || 500
      return c.json(errorResponse(result.error.code, result.error.message), status)
    }

    return c.json({
      success: true,
      data: result.value,
    })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

/**
 * Gets a single setting value by key.
 *
 * @route GET /api/v1/sdk/settings/:key
 * @access Protected - Requires X-App-Installation-Id header
 */
settings.get('/:key', async (c) => {
  try {
    const key = c.req.param('key')
    const auth = verifyCallbackAuth(c, 'settings')
    if (!auth) return c.res

    // Load installation with current deployment for settings schema
    const installation = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, auth.installationId),
      columns: {
        id: true,
        currentDeploymentId: true,
      },
      with: {
        currentDeployment: {
          columns: {
            settingsSchema: true,
          },
        },
      },
    })

    if (!installation) {
      return c.json(errorResponse('NOT_FOUND', 'Installation not found'), 404)
    }

    // Extract organization schema from deployment
    const settingsSchemaObj = installation.currentDeployment?.settingsSchema as {
      organization?: any
    } | null
    const schema = settingsSchemaObj?.organization

    // Get all settings with schema (so defaults work), then extract the key
    const result = await getAppSettings({
      appInstallationId: auth.installationId,
      schema,
    })

    if (result.isErr()) {
      const status = ERROR_STATUS_MAP[result.error.code] || 500
      return c.json(errorResponse(result.error.code, result.error.message), status)
    }

    // Extract the specific key (undefined if not in schema and not saved)
    const value = result.value[key]

    return c.json({
      success: true,
      data: {
        value: value ?? null,
      },
    })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

/**
 * Saves multiple settings at once.
 * This is called by app extensions running in Lambda to persist settings.
 *
 * @route POST /api/v1/sdk/settings
 * @access Protected - Requires X-App-Installation-Id header
 *
 * @param {Object} c - Hono context object
 * @param {Function} c.req.header - Function to get request headers
 * @param {Function} c.req.json - Function to parse request body as JSON
 * @param {Function} c.json - Function to return JSON response
 *
 * @returns {Promise<Response>} JSON response confirming save or error
 *
 * @example Request Headers
 * {
 *   "Content-Type": "application/json",
 *   "X-App-Installation-Id": "app_install_abc123xyz"
 * }
 *
 * @example Request Body
 * {
 *   "settings": {
 *     "apiKey": "sk_new_key_456",
 *     "maxRetries": 3,
 *     "enableLogging": false
 *   }
 * }
 *
 * @example Success Response (200)
 * {
 *   "success": true,
 *   "data": {
 *     "success": true
 *   }
 * }
 *
 * @example Error Response - Missing Auth Header (401)
 * {
 *   "success": false,
 *   "error": {
 *     "code": "UNAUTHORIZED",
 *     "message": "App installation ID required"
 *   }
 * }
 *
 * @example Error Response - Invalid Request (400)
 * {
 *   "success": false,
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "settings is required"
 *   }
 * }
 *
 * @throws {ValidationError} When request body doesn't match schema
 * @throws {UnauthorizedError} When X-App-Installation-Id header is missing
 * @throws {InternalError} When database operation fails
 */
settings.post('/', async (c) => {
  try {
    const auth = verifyCallbackAuth(c, 'settings')
    if (!auth) return c.res

    const body = await c.req.json()
    const { settings: settingsToSave } = saveSettingsSchema.parse(body)

    // Load installation to get current deployment
    const installation = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, auth.installationId),
      columns: {
        id: true,
        currentDeploymentId: true,
      },
    })

    if (!installation) {
      return c.json(errorResponse('NOT_FOUND', 'Installation not found'), 404)
    }

    // Save settings with deployment ID to track which deployment they were saved with
    const result = await saveAppSettings({
      appInstallationId: auth.installationId,
      appDeploymentId: installation.currentDeploymentId ?? undefined,
      settings: settingsToSave,
    })

    if (result.isErr()) {
      const status = ERROR_STATUS_MAP[result.error.code] || 500
      return c.json(errorResponse(result.error.code, result.error.message), status)
    }

    return c.json({
      success: true,
      data: { success: true },
    })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

/**
 * Sets a single setting value by key.
 * Updates or creates the setting with the provided value.
 *
 * @route PUT /api/v1/sdk/settings/:key
 * @access Protected - Requires X-App-Installation-Id header
 *
 * @param {Object} c - Hono context object
 * @param {Function} c.req.param - Function to get URL parameters
 * @param {Function} c.req.header - Function to get request headers
 * @param {Function} c.req.json - Function to parse request body as JSON
 * @param {Function} c.json - Function to return JSON response
 *
 * @returns {Promise<Response>} JSON response confirming update or error
 *
 * @example URL Parameters
 * key: "maxRetries"
 *
 * @example Request Headers
 * {
 *   "Content-Type": "application/json",
 *   "X-App-Installation-Id": "app_install_abc123xyz"
 * }
 *
 * @example Request Body
 * {
 *   "value": 10
 * }
 *
 * @example Success Response (200)
 * {
 *   "success": true,
 *   "data": {
 *     "success": true
 *   }
 * }
 *
 * @example Error Response - Unauthorized (401)
 * {
 *   "success": false,
 *   "error": {
 *     "code": "UNAUTHORIZED",
 *     "message": "App installation ID required"
 *   }
 * }
 *
 * @throws {ValidationError} When request body doesn't match schema
 * @throws {UnauthorizedError} When X-App-Installation-Id header is missing
 * @throws {InternalError} When database operation fails
 */
settings.put('/:key', async (c) => {
  try {
    const key = c.req.param('key')
    const auth = verifyCallbackAuth(c, 'settings')
    if (!auth) return c.res

    const body = await c.req.json()
    const { value } = setSettingSchema.parse(body)

    // Load installation to get current deployment
    const installation = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, auth.installationId),
      columns: {
        id: true,
        currentDeploymentId: true,
      },
    })

    if (!installation) {
      return c.json(errorResponse('NOT_FOUND', 'Installation not found'), 404)
    }

    // Set setting with deployment ID
    const result = await setAppSetting({
      appInstallationId: auth.installationId,
      appDeploymentId: installation.currentDeploymentId ?? undefined,
      key,
      value,
    })

    if (result.isErr()) {
      const status = ERROR_STATUS_MAP[result.error.code] || 500
      return c.json(errorResponse(result.error.code, result.error.message), status)
    }

    return c.json({
      success: true,
      data: { success: true },
    })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

/**
 * Export the configured Hono router for settings routes.
 * Mount this router at /api/v1/sdk/settings in the main API application.
 *
 * @exports settings
 * @type {Hono<AppContext>}
 *
 * @example Mounting the router
 * import settings from './routes/settings'
 * app.route('/api/v1/sdk/settings', settings)
 */
export default settings
