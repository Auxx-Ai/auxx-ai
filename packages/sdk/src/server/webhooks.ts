// packages/sdk/src/server/webhooks.ts

/**
 * Webhook handler metadata returned by createWebhookHandler
 */
export interface WebhookHandler {
  /** Unique handler ID */
  id: string

  /** Public webhook URL to register with third-party service */
  url: string

  /** Handler file name (without .webhook.ts suffix) */
  fileName: string

  /** External webhook ID from third-party service (e.g., Shopify webhook ID) */
  externalWebhookId?: string

  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Create a webhook handler and get its public URL.
 *
 * @param options - Handler creation options
 * @returns Webhook handler with public URL
 *
 * @example
 * ```typescript
 * // In connection-added.event.ts
 * import { createWebhookHandler } from '@auxx/sdk/server'
 *
 * export default async function connectionAdded({ connection }) {
 *   const handler = await createWebhookHandler({
 *     fileName: "prospect-updated"
 *   })
 *
 *   // Register with third-party service
 *   await fetch('https://api.example.com/webhooks', {
 *     method: 'POST',
 *     headers: { 'Authorization': `Bearer ${connection.value}` },
 *     body: JSON.stringify({
 *       url: handler.url,
 *       events: ['prospect.updated']
 *     })
 *   })
 * }
 * ```
 */
export async function createWebhookHandler(options: {
  fileName: string
  triggerId?: string
  connectionId?: string
  metadata?: Record<string, unknown>
}): Promise<WebhookHandler> {
  // Runtime injection
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.createWebhookHandler === 'function') {
      return sdk.createWebhookHandler(options)
    }
  }

  throw new Error('[auxx/server] Server SDK not available')
}

/**
 * Update webhook handler metadata.
 * Typically used to store external webhook ID for cleanup.
 *
 * @param handlerId - Handler ID from createWebhookHandler
 * @param updates - Fields to update
 *
 * @example
 * ```typescript
 * const response = await fetch('https://api.example.com/webhooks', {
 *   method: 'POST',
 *   body: JSON.stringify({ url: handler.url })
 * })
 *
 * const { webhook_id } = await response.json()
 *
 * // Store external ID for cleanup
 * await updateWebhookHandler(handler.id, {
 *   externalWebhookId: webhook_id
 * })
 * ```
 */
export async function updateWebhookHandler(
  handlerId: string,
  updates: {
    externalWebhookId?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.updateWebhookHandler === 'function') {
      return sdk.updateWebhookHandler(handlerId, updates)
    }
  }

  throw new Error('[auxx/server] Server SDK not available')
}

/**
 * Delete webhook handler.
 *
 * @param handlerId - Handler ID to delete
 */
export async function deleteWebhookHandler(handlerId: string): Promise<void> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.deleteWebhookHandler === 'function') {
      return sdk.deleteWebhookHandler(handlerId)
    }
  }

  throw new Error('[auxx/server] Server SDK not available')
}

/**
 * List all webhook handlers for current app installation.
 *
 * @returns Array of webhook handlers
 *
 * @example
 * ```typescript
 * // In connection-removed.event.ts
 * import { listWebhookHandlers, deleteWebhookHandler } from '@auxx/sdk/server'
 *
 * export default async function connectionRemoved({ connection }) {
 *   // Get all webhook handlers
 *   const handlers = await listWebhookHandlers()
 *
 *   // Delete each handler
 *   for (const handler of handlers) {
 *     await deleteWebhookHandler(handler.id)
 *   }
 * }
 * ```
 */
export async function listWebhookHandlers(): Promise<WebhookHandler[]> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.listWebhookHandlers === 'function') {
      return sdk.listWebhookHandlers()
    }
  }

  throw new Error('[auxx/server] Server SDK not available')
}
