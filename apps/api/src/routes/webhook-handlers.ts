// apps/api/src/routes/webhook-handlers.ts

/**
 * @fileoverview Webhook handler management routes for Auxx.ai apps.
 * Provides endpoints for creating, updating, and deleting webhook handlers that process
 * incoming webhooks from external services (e.g., Shopify, Stripe). These handlers are
 * registered by app extensions via Lambda and execute custom code when webhooks are received.
 *
 * @module routes/webhook-handlers
 */

import {
  createWebhookHandler,
  deleteWebhookHandler,
  listWebhookHandlers,
  updateWebhookHandler,
} from '@auxx/services/app-webhook-handlers'
import { Hono } from 'hono'
import { z } from 'zod'
import { ERROR_STATUS_MAP, errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

/**
 * Hono router instance for webhook handler management.
 * All routes require X-App-Installation-Id header for authentication.
 *
 * @type {Hono<AppContext>}
 */
const webhookHandlers = new Hono<AppContext>()

/**
 * Schema for creating a new webhook handler.
 * Validates the request body for POST /apps/webhooks endpoint.
 *
 * @typedef {Object} CreateWebhookHandlerRequest
 * @property {string} fileName - Name of the handler file (e.g., "order-created.ts")
 * @property {Record<string, unknown>} [metadata] - Optional metadata for the handler
 *
 * @example
 * {
 *   "fileName": "shopify-order-created.ts",
 *   "metadata": {
 *     "version": "1.0.0",
 *     "description": "Handles Shopify order creation webhooks",
 *     "topics": ["orders/create"]
 *   }
 * }
 */
const createWebhookHandlerSchema = z.object({
  fileName: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Schema for updating an existing webhook handler.
 * Validates the request body for PATCH /apps/webhooks/:handlerId endpoint.
 *
 * @typedef {Object} UpdateWebhookHandlerRequest
 * @property {string} [externalWebhookId] - External webhook ID from the service (e.g., Shopify webhook ID)
 * @property {Record<string, unknown>} [metadata] - Updated metadata for the handler
 *
 * @example
 * {
 *   "externalWebhookId": "gid://shopify/WebhookSubscription/12345",
 *   "metadata": {
 *     "version": "1.1.0",
 *     "lastUpdated": "2025-10-24T10:30:00Z",
 *     "status": "active"
 *   }
 * }
 */
const updateWebhookHandlerSchema = z.object({
  externalWebhookId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Lists all webhook handlers for an app installation.
 * Returns all webhook handlers (both active and inactive) associated with the app installation.
 *
 * @route GET /apps/webhooks
 * @access Protected - Requires X-App-Installation-Id header
 *
 * @param {Object} c - Hono context object
 * @param {Function} c.req.header - Function to get request headers
 * @param {Function} c.json - Function to return JSON response
 *
 * @returns {Promise<Response>} JSON response with array of webhook handlers or error
 *
 * @example Request Headers
 * {
 *   "X-App-Installation-Id": "app_install_abc123xyz"
 * }
 *
 * @example Success Response (200)
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "wh_handler_xyz789",
 *       "appInstallationId": "app_install_abc123xyz",
 *       "handlerId": "shopify-order-created",
 *       "url": "https://api.auxx.ai/webhooks/app_install_abc123xyz/shopify-order-created",
 *       "externalWebhookId": "gid://shopify/WebhookSubscription/12345",
 *       "metadata": "{\"version\":\"1.0.0\"}",
 *       "isActive": true,
 *       "createdAt": "2025-10-24T10:30:00Z",
 *       "updatedAt": "2025-10-24T10:30:00Z"
 *     }
 *   ]
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
webhookHandlers.get('/', async (c) => {
  try {
    const appInstallationId = c.req.header('X-App-Installation-Id')

    if (!appInstallationId) {
      return c.json(errorResponse('UNAUTHORIZED', 'App installation ID required'), 401)
    }

    const result = await listWebhookHandlers({ appInstallationId })

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
 * Creates a new webhook handler for an app installation.
 * This endpoint is called by app extensions running in Lambda to register a webhook handler
 * that will process incoming webhooks from external services.
 *
 * @route POST /apps/webhooks
 * @access Protected - Requires X-App-Installation-Id header
 *
 * @param {Object} c - Hono context object
 * @param {Function} c.req.header - Function to get request headers
 * @param {Function} c.req.json - Function to parse request body as JSON
 * @param {Function} c.json - Function to return JSON response
 *
 * @returns {Promise<Response>} JSON response with created handler or error
 *
 * @example Request Headers
 * {
 *   "Content-Type": "application/json",
 *   "X-App-Installation-Id": "app_install_abc123xyz"
 * }
 *
 * @example Request Body
 * {
 *   "fileName": "shopify-order-created.ts",
 *   "metadata": {
 *     "version": "1.0.0",
 *     "description": "Processes Shopify order creation events",
 *     "topics": ["orders/create"],
 *     "webhookUrl": "https://mystore.myshopify.com/admin/webhooks"
 *   }
 * }
 *
 * @example Success Response (201)
 * {
 *   "success": true,
 *   "data": {
 *     "id": "wh_handler_xyz789",
 *     "appInstallationId": "app_install_abc123xyz",
 *     "fileName": "shopify-order-created.ts",
 *     "metadata": {
 *       "version": "1.0.0",
 *       "description": "Processes Shopify order creation events",
 *       "topics": ["orders/create"]
 *     },
 *     "createdAt": "2025-10-24T10:30:00Z",
 *     "updatedAt": "2025-10-24T10:30:00Z"
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
 *     "message": "fileName is required"
 *   }
 * }
 *
 * @throws {ValidationError} When request body doesn't match schema
 * @throws {UnauthorizedError} When X-App-Installation-Id header is missing
 * @throws {InternalError} When database operation fails
 */
webhookHandlers.post('/', async (c) => {
  try {
    // Get app installation ID from header (set by Lambda runtime)
    const appInstallationId = c.req.header('X-App-Installation-Id')

    if (!appInstallationId) {
      return c.json(errorResponse('UNAUTHORIZED', 'App installation ID required'), 401)
    }

    const body = await c.req.json()
    const { fileName, metadata } = createWebhookHandlerSchema.parse(body)

    const result = await createWebhookHandler({
      appInstallationId,
      fileName,
      metadata,
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
 * Updates an existing webhook handler's metadata or external webhook ID.
 * Used to sync webhook handler state with external services (e.g., updating the Shopify webhook ID
 * after successful registration) or to modify handler metadata.
 *
 * @route PATCH /apps/webhooks/:handlerId
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
 * handlerId: "wh_handler_xyz789"
 *
 * @example Request Headers
 * {
 *   "Content-Type": "application/json",
 *   "X-App-Installation-Id": "app_install_abc123xyz"
 * }
 *
 * @example Request Body - Update External Webhook ID
 * {
 *   "externalWebhookId": "gid://shopify/WebhookSubscription/98765"
 * }
 *
 * @example Request Body - Update Metadata
 * {
 *   "metadata": {
 *     "version": "1.2.0",
 *     "status": "active",
 *     "lastTriggered": "2025-10-24T15:45:00Z",
 *     "executionCount": 127
 *   }
 * }
 *
 * @example Request Body - Update Both
 * {
 *   "externalWebhookId": "gid://shopify/WebhookSubscription/98765",
 *   "metadata": {
 *     "version": "1.2.0",
 *     "status": "active",
 *     "webhookRegisteredAt": "2025-10-24T10:30:00Z"
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
 * @example Error Response - Handler Not Found (404)
 * {
 *   "success": false,
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "Webhook handler not found"
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
 * @throws {UnauthorizedError} When X-App-Installation-Id header is missing or invalid
 * @throws {NotFoundError} When webhook handler doesn't exist
 * @throws {InternalError} When database operation fails
 */
webhookHandlers.patch('/:handlerId', async (c) => {
  try {
    const handlerId = c.req.param('handlerId')
    const appInstallationId = c.req.header('X-App-Installation-Id')

    if (!appInstallationId) {
      return c.json(errorResponse('UNAUTHORIZED', 'App installation ID required'), 401)
    }

    const body = await c.req.json()
    const { externalWebhookId, metadata } = updateWebhookHandlerSchema.parse(body)

    const result = await updateWebhookHandler({
      handlerId,
      appInstallationId,
      externalWebhookId,
      metadata,
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
 * Deletes a webhook handler and removes it from the system.
 * This is typically called when an app is uninstalled or when a webhook subscription is
 * manually removed. The handler will no longer process incoming webhooks after deletion.
 *
 * @route DELETE /apps/webhooks/:handlerId
 * @access Protected - Requires X-App-Installation-Id header
 *
 * @param {Object} c - Hono context object
 * @param {Function} c.req.param - Function to get URL parameters
 * @param {Function} c.req.header - Function to get request headers
 * @param {Function} c.json - Function to return JSON response
 *
 * @returns {Promise<Response>} JSON response confirming deletion or error
 *
 * @example URL Parameters
 * handlerId: "wh_handler_xyz789"
 *
 * @example Request Headers
 * {
 *   "Content-Type": "application/json",
 *   "X-App-Installation-Id": "app_install_abc123xyz"
 * }
 *
 * @example cURL Request
 * curl -X DELETE https://api.auxx.ai/apps/webhooks/wh_handler_xyz789 \
 *   -H "X-App-Installation-Id: app_install_abc123xyz" \
 *   -H "Content-Type: application/json"
 *
 * @example Success Response (200)
 * {
 *   "success": true,
 *   "data": {
 *     "success": true
 *   }
 * }
 *
 * @example Error Response - Handler Not Found (404)
 * {
 *   "success": false,
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "Webhook handler not found"
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
 * @example Error Response - Forbidden (403)
 * {
 *   "success": false,
 *   "error": {
 *     "code": "FORBIDDEN",
 *     "message": "Cannot delete webhook handler from different app installation"
 *   }
 * }
 *
 * @throws {UnauthorizedError} When X-App-Installation-Id header is missing
 * @throws {ForbiddenError} When trying to delete a handler from a different app installation
 * @throws {NotFoundError} When webhook handler doesn't exist
 * @throws {InternalError} When database operation fails
 */
webhookHandlers.delete('/:handlerId', async (c) => {
  try {
    const handlerId = c.req.param('handlerId')
    const appInstallationId = c.req.header('X-App-Installation-Id')

    if (!appInstallationId) {
      return c.json(errorResponse('UNAUTHORIZED', 'App installation ID required'), 401)
    }

    const result = await deleteWebhookHandler({ handlerId, appInstallationId })

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
 * Export the configured Hono router for webhook handler routes.
 * Mount this router at /apps/webhooks in the main API application.
 *
 * @exports webhookHandlers
 * @type {Hono<AppContext>}
 *
 * @example Mounting the router
 * import webhookHandlers from './routes/webhook-handlers'
 * app.route('/apps/webhooks', webhookHandlers)
 */
export default webhookHandlers
