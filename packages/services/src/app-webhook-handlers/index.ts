// packages/services/src/app-webhook-handlers/index.ts

import { API_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import type { DatabaseError } from '../shared/errors'
import { fromDatabase } from '../shared/utils'

/** Scoped logger for webhook handler operations */
const logger = createScopedLogger('app-webhook-handlers')

/**
 * Webhook handler error codes
 */
export type WebhookHandlerError =
  | DatabaseError
  | {
      code: 'HANDLER_NOT_FOUND'
      message: string
      handlerId?: string
      appInstallationId?: string
    }
  | {
      code: 'HANDLER_CREATION_FAILED'
      message: string
      appInstallationId: string
      fileName: string
    }

/**
 * @fileoverview Webhook handler service for managing app webhook registrations
 *
 * This module provides functionality to create, update, delete, and retrieve webhook
 * handlers for app installations. Webhook handlers are used to receive and process
 * webhook events from third-party services (e.g., Shopify, Gmail, Outlook).
 *
 * Each webhook handler has:
 * - A unique public URL that receives webhook events
 * - Association with a specific app installation
 * - Optional metadata for storing additional configuration
 * - Optional external webhook ID for tracking third-party webhook subscriptions
 *
 * @example
 * ```typescript
 * import {
 *   createWebhookHandler,
 *   updateWebhookHandler,
 *   listWebhookHandlers
 * } from '@auxx/services/app-webhook-handlers'
 *
 * // Create a webhook handler
 * const handler = await createWebhookHandler({
 *   appInstallationId: "app_shopify_123",
 *   fileName: "order-created",
 *   metadata: { topic: "orders/create" }
 * })
 *
 * // List all handlers for an app
 * const handlers = await listWebhookHandlers({
 *   appInstallationId: "app_shopify_123"
 * })
 * ```
 */

/**
 * Parameters for creating a webhook handler
 *
 * @property {string} appInstallationId - The unique ID of the app installation
 * @property {string} fileName - The handler file name (e.g., "order-created" or "customer-updated")
 * @property {Record<string, unknown>} [metadata] - Optional metadata to store with the handler
 *
 * @example
 * ```typescript
 * const params: CreateWebhookHandlerParams = {
 *   appInstallationId: "app_123",
 *   fileName: "order-created",
 *   metadata: { topic: "orders/create", version: "2024-01" }
 * }
 * ```
 */
export interface CreateWebhookHandlerParams {
  appInstallationId: string
  fileName: string
  metadata?: Record<string, unknown>
}

/**
 * Parameters for updating an existing webhook handler
 *
 * @property {string} handlerId - The unique ID of the webhook handler to update
 * @property {string} appInstallationId - The unique ID of the app installation
 * @property {string} [externalWebhookId] - Optional external webhook ID (e.g., from Shopify)
 * @property {Record<string, unknown>} [metadata] - Optional metadata to update
 *
 * @example
 * ```typescript
 * const params: UpdateWebhookHandlerParams = {
 *   handlerId: "handler_123",
 *   appInstallationId: "app_123",
 *   externalWebhookId: "shopify_webhook_456",
 *   metadata: { lastTriggered: "2024-01-15T10:00:00Z" }
 * }
 * ```
 */
export interface UpdateWebhookHandlerParams {
  handlerId: string
  appInstallationId: string
  externalWebhookId?: string
  metadata?: Record<string, unknown>
}

/**
 * Response data for a webhook handler operation
 *
 * @property {string} id - The unique ID of the webhook handler
 * @property {string} url - The public webhook URL that receives webhook events
 * @property {string} fileName - The handler file name
 * @property {string} [externalWebhookId] - External webhook ID from third-party service
 * @property {Record<string, unknown>} [metadata] - Optional metadata stored with the handler
 *
 * @example
 * ```typescript
 * const response: WebhookHandlerResponse = {
 *   id: "handler_123",
 *   url: "https://api.auxx.ai/webhooks/app_123/order-created",
 *   fileName: "order-created",
 *   externalWebhookId: "shopify_webhook_456",
 *   metadata: { topic: "orders/create" }
 * }
 * ```
 */
export interface WebhookHandlerResponse {
  id: string
  url: string
  fileName: string
  externalWebhookId?: string
  metadata?: Record<string, unknown>
}

/**
 * Creates or updates a webhook handler for an app installation.
 *
 * This function generates a public webhook URL and stores the handler configuration
 * in the database. If a handler with the same appInstallationId and fileName already
 * exists, it will be updated with the new values.
 *
 * @param {CreateWebhookHandlerParams} params - The webhook handler parameters
 * @returns {Promise<Result<WebhookHandlerResponse, WebhookHandlerError>>} Result with created/updated webhook handler
 *
 * @example
 * ```typescript
 * // Create a new webhook handler for order creation events
 * const result = await createWebhookHandler({
 *   appInstallationId: "app_shopify_123",
 *   fileName: "order-created",
 *   metadata: {
 *     topic: "orders/create",
 *     version: "2024-01",
 *     description: "Handles new order notifications"
 *   }
 * })
 *
 * if (result.isOk()) {
 *   console.log(result.value.url)
 *   // => "https://api.auxx.ai/webhooks/app_shopify_123/order-created"
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Update existing handler by using the same appInstallationId and fileName
 * const result = await createWebhookHandler({
 *   appInstallationId: "app_shopify_123",
 *   fileName: "order-created",
 *   metadata: {
 *     topic: "orders/create",
 *     version: "2024-02", // Updated version
 *     lastUpdated: new Date().toISOString()
 *   }
 * })
 *
 * if (result.isErr()) {
 *   console.error('Failed to create handler:', result.error.message)
 * }
 * ```
 */
export async function createWebhookHandler(params: CreateWebhookHandlerParams) {
  const { appInstallationId, fileName, metadata } = params

  logger.info('Creating webhook handler', { appInstallationId, fileName })

  // Generate public webhook URL
  const url = `${API_URL}/webhooks/${appInstallationId}/${fileName}`

  // Create or update webhook handler
  const dbResult = await fromDatabase(
    database
      .insert(schema.AppWebhookHandler)
      .values({
        appInstallationId,
        handlerId: fileName,
        url,
        metadata: metadata ? JSON.stringify(metadata) : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.AppWebhookHandler.appInstallationId, schema.AppWebhookHandler.handlerId],
        set: {
          url,
          metadata: metadata ? JSON.stringify(metadata) : null,
          updatedAt: new Date(),
        },
      })
      .returning(),
    'create-webhook-handler'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const [handler] = dbResult.value

  if (!handler) {
    return err({
      code: 'HANDLER_CREATION_FAILED' as const,
      message: 'Failed to create webhook handler',
      appInstallationId,
      fileName,
    })
  }

  logger.info('Created webhook handler', { handlerId: handler.id, url })

  return ok({
    id: handler.id,
    url: handler.url,
    fileName,
    externalWebhookId: handler.externalWebhookId ?? undefined,
    metadata: metadata,
  })
}

/**
 * Updates an existing webhook handler's metadata and external webhook ID.
 *
 * This function updates the webhook handler record in the database with new
 * metadata or external webhook ID (e.g., from third-party services like Shopify).
 * Only updates the fields provided in the params.
 *
 * @param {UpdateWebhookHandlerParams} params - The update parameters
 * @returns {Promise<Result<void, WebhookHandlerError>>} Result indicating success or failure
 *
 * @example
 * ```typescript
 * // Update webhook handler with external webhook ID from Shopify
 * const result = await updateWebhookHandler({
 *   handlerId: "handler_abc123",
 *   appInstallationId: "app_shopify_123",
 *   externalWebhookId: "shopify_webhook_789",
 *   metadata: {
 *     shopifyWebhookId: "789",
 *     registeredAt: new Date().toISOString()
 *   }
 * })
 *
 * if (result.isErr()) {
 *   console.error('Update failed:', result.error.message)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Update only metadata
 * const result = await updateWebhookHandler({
 *   handlerId: "handler_abc123",
 *   appInstallationId: "app_shopify_123",
 *   metadata: {
 *     lastTriggered: "2024-01-15T14:30:00Z",
 *     triggerCount: 42
 *   }
 * })
 * ```
 */
export async function updateWebhookHandler(params: UpdateWebhookHandlerParams) {
  const { handlerId, appInstallationId, externalWebhookId, metadata } = params

  logger.info('Updating webhook handler', { handlerId, appInstallationId })

  const dbResult = await fromDatabase(
    database
      .update(schema.AppWebhookHandler)
      .set({
        externalWebhookId,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AppWebhookHandler.id, handlerId),
          eq(schema.AppWebhookHandler.appInstallationId, appInstallationId)
        )
      ),
    'update-webhook-handler'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  logger.info('Updated webhook handler', { handlerId })

  return ok(undefined)
}

/**
 * Deletes a webhook handler from the database.
 *
 * Permanently removes the webhook handler record. This should typically be called
 * when an app is uninstalled or when a specific webhook subscription is removed.
 *
 * @param {Object} params - The deletion parameters
 * @param {string} params.handlerId - The unique ID of the webhook handler to delete
 * @param {string} params.appInstallationId - The unique ID of the app installation
 * @returns {Promise<Result<void, WebhookHandlerError>>} Result indicating success or failure
 *
 * @example
 * ```typescript
 * // Delete a specific webhook handler
 * const result = await deleteWebhookHandler({
 *   handlerId: "handler_abc123",
 *   appInstallationId: "app_shopify_123"
 * })
 *
 * if (result.isErr()) {
 *   console.error('Delete failed:', result.error.message)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Delete webhook handler when app is uninstalled
 * const handlersResult = await listWebhookHandlers({ appInstallationId: "app_shopify_123" })
 *
 * if (handlersResult.isOk()) {
 *   for (const handler of handlersResult.value) {
 *     await deleteWebhookHandler({
 *       handlerId: handler.id,
 *       appInstallationId: "app_shopify_123"
 *     })
 *   }
 * }
 * ```
 */
export async function deleteWebhookHandler(params: {
  handlerId: string
  appInstallationId: string
}) {
  const { handlerId, appInstallationId } = params

  logger.info('Deleting webhook handler', { handlerId, appInstallationId })

  const dbResult = await fromDatabase(
    database
      .delete(schema.AppWebhookHandler)
      .where(
        and(
          eq(schema.AppWebhookHandler.id, handlerId),
          eq(schema.AppWebhookHandler.appInstallationId, appInstallationId)
        )
      ),
    'delete-webhook-handler'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  logger.info('Deleted webhook handler', { handlerId })

  return ok(undefined)
}

/**
 * Retrieves a specific webhook handler by app installation ID and handler ID.
 *
 * Returns only active webhook handlers. If the handler is not found or inactive,
 * returns an error.
 *
 * @param {Object} params - The query parameters
 * @param {string} params.appInstallationId - The unique ID of the app installation
 * @param {string} params.handlerId - The unique handler ID (fileName)
 * @returns {Promise<Result<typeof schema.AppWebhookHandler.$inferSelect, WebhookHandlerError>>} Result with the webhook handler
 *
 * @example
 * ```typescript
 * // Get a specific webhook handler
 * const result = await getWebhookHandler({
 *   appInstallationId: "app_shopify_123",
 *   handlerId: "order-created"
 * })
 *
 * if (result.isOk()) {
 *   const handler = result.value
 *   console.log(`Webhook URL: ${handler.url}`)
 *   console.log(`External ID: ${handler.externalWebhookId}`)
 * } else {
 *   console.log('Handler not found or inactive')
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Check if handler exists before updating
 * const result = await getWebhookHandler({
 *   appInstallationId: "app_shopify_123",
 *   handlerId: "order-created"
 * })
 *
 * if (result.isOk()) {
 *   await updateWebhookHandler({
 *     handlerId: result.value.id,
 *     appInstallationId: "app_shopify_123",
 *     metadata: { updated: true }
 *   })
 * }
 * ```
 */
export async function getWebhookHandler(params: { appInstallationId: string; handlerId: string }) {
  const { appInstallationId, handlerId } = params

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.AppWebhookHandler)
      .where(
        and(
          eq(schema.AppWebhookHandler.appInstallationId, appInstallationId),
          eq(schema.AppWebhookHandler.handlerId, handlerId),
          eq(schema.AppWebhookHandler.isActive, true)
        )
      )
      .limit(1),
    'get-webhook-handler'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const [handler] = dbResult.value

  if (!handler) {
    return err({
      code: 'HANDLER_NOT_FOUND' as const,
      message: `Webhook handler not found: ${handlerId}`,
      handlerId,
      appInstallationId,
    })
  }

  return ok(handler)
}

/**
 * Lists all webhook handlers for a specific app installation.
 *
 * Returns all webhook handlers (both active and inactive) associated with the
 * given app installation. Useful for displaying all registered webhooks or
 * performing bulk operations.
 *
 * @param {Object} params - The query parameters
 * @param {string} params.appInstallationId - The unique ID of the app installation
 * @returns {Promise<Result<Array<typeof schema.AppWebhookHandler.$inferSelect>, WebhookHandlerError>>} Result with array of webhook handlers
 *
 * @example
 * ```typescript
 * // List all webhook handlers for an app
 * const result = await listWebhookHandlers({
 *   appInstallationId: "app_shopify_123"
 * })
 *
 * if (result.isOk()) {
 *   const handlers = result.value
 *   console.log(`Found ${handlers.length} webhook handlers`)
 *   handlers.forEach(handler => {
 *     console.log(`- ${handler.handlerId}: ${handler.url}`)
 *   })
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Filter active handlers
 * const result = await listWebhookHandlers({
 *   appInstallationId: "app_shopify_123"
 * })
 *
 * if (result.isOk()) {
 *   const allHandlers = result.value
 *   const activeHandlers = allHandlers.filter(h => h.isActive)
 *   const inactiveHandlers = allHandlers.filter(h => !h.isActive)
 *
 *   console.log(`Active: ${activeHandlers.length}, Inactive: ${inactiveHandlers.length}`)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Delete all handlers when app is uninstalled
 * const result = await listWebhookHandlers({
 *   appInstallationId: "app_shopify_123"
 * })
 *
 * if (result.isOk()) {
 *   await Promise.all(
 *     result.value.map(handler =>
 *       deleteWebhookHandler({
 *         handlerId: handler.id,
 *         appInstallationId: "app_shopify_123"
 *       })
 *     )
 *   )
 * }
 * ```
 */
export async function listWebhookHandlers(params: { appInstallationId: string }) {
  const { appInstallationId } = params

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.AppWebhookHandler)
      .where(eq(schema.AppWebhookHandler.appInstallationId, appInstallationId)),
    'list-webhook-handlers'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  return ok(dbResult.value)
}
