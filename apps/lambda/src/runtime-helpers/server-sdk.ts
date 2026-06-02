// apps/lambda/src/runtime-helpers/server-sdk.ts

/**
 * Server SDK implementation for Lambda runtime
 *
 * Provides the runtime implementation for @auxx/sdk/server functions.
 * These functions are injected into the global scope before executing extension code.
 *
 * @module runtime-helpers/server-sdk
 *
 * @example
 * ```typescript
 * import { createServerSDK } from './server-sdk'
 *
 * // Create SDK instance with runtime context
 * const sdk = createServerSDK(context)
 *
 * // Extension code can now use SDK methods
 * const user = sdk.getCurrentUser()
 * const connection = sdk.getUserConnection()
 * const response = await sdk.fetch({ method: 'GET', url: 'https://api.example.com' })
 * ```
 */

import type { RuntimeContext } from '../types.ts'
import { parseError } from '../utils.ts'

/**
 * Connection interface (matches @auxx/sdk/server/connections)
 *
 * Represents an external service connection (OAuth2 or secret-based).
 * Connections can be scoped to users or organizations.
 *
 * @interface Connection
 * @property {string} id - Unique connection identifier
 * @property {('oauth2-code'|'secret')} type - Authentication type
 * @property {string} value - The access token or secret value
 * @property {Object} [metadata] - Additional connection metadata
 * @property {string} [metadata.scope] - OAuth2 scopes granted
 * @property {string} [metadata.externalUserId] - External service user ID
 * @property {string} [metadata.tokenType] - Token type (e.g., 'Bearer')
 * @property {Date} [expiresAt] - Token expiration date (OAuth2 only)
 *
 * @example
 * ```typescript
 * // OAuth2 connection
 * const connection: Connection = {
 *   id: 'conn_abc123',
 *   type: 'oauth2-code',
 *   value: 'ya29.a0AfH6SMB...',
 *   metadata: {
 *     scope: 'email profile',
 *     externalUserId: 'google-user-123',
 *     tokenType: 'Bearer'
 *   },
 *   expiresAt: new Date('2025-12-31')
 * }
 *
 * // Secret connection
 * const secretConnection: Connection = {
 *   id: 'conn_xyz789',
 *   type: 'secret',
 *   value: 'sk_live_abc123...',
 *   metadata: {}
 * }
 * ```
 */
export interface Connection {
  id: string
  type: 'oauth2-code' | 'secret'
  value: string
  metadata?: {
    scope?: string
    externalUserId?: string
    tokenType?: string
    [key: string]: any
  }
  expiresAt?: Date
}

/**
 * Webhook handler metadata
 *
 * Represents a registered webhook handler for receiving external events.
 * Extensions can create webhooks to receive notifications from external services.
 *
 * @interface WebhookHandler
 * @property {string} id - Unique handler identifier
 * @property {string} url - Public URL to receive webhook events
 * @property {string} fileName - Handler file name in extension (e.g., 'webhooks/stripe.ts')
 * @property {string} [externalWebhookId] - External service's webhook ID (for cleanup)
 * @property {Record<string, unknown>} [metadata] - Custom metadata for the handler
 *
 * @example
 * ```typescript
 * const handler: WebhookHandler = {
 *   id: 'wh_abc123',
 *   url: 'https://api.auxx.ai/webhooks/wh_abc123',
 *   fileName: 'webhooks/github-push.ts',
 *   externalWebhookId: 'github-webhook-456',
 *   metadata: {
 *     events: ['push', 'pull_request'],
 *     repository: 'myorg/myrepo'
 *   }
 * }
 * ```
 */
export interface WebhookHandler {
  id: string
  url: string
  fileName: string
  externalWebhookId?: string
  connectionId?: string
  metadata?: Record<string, unknown>
}

/**
 * Server SDK interface injected into global scope
 *
 * Main SDK interface providing runtime functions for extensions.
 * All methods are injected as AUXX_SERVER_SDK global object.
 *
 * @interface ServerSDK
 */
export interface ServerSDK {
  getCurrentUser: () => {
    id: string
    email: string | null | undefined
    name: string
    avatar?: string
    role?: string
  }
  getApiToken: () => never
  query: (options: { sql: string; params?: unknown[] }) => never
  fetch: (options: ServerSDKFetchOptions) => Promise<ServerSDKFetchResponse>
  storage: {
    get: (key: string) => never
    set: (key: string, value: unknown) => never
    delete: (key: string) => never
  }
  workflow: Record<string, unknown>
  getUserConnection: () => Connection | undefined
  getOrganizationConnection: () => Connection | undefined
  getConnection: () => Connection | undefined
  createWebhookHandler: (options: {
    fileName: string
    triggerId?: string
    connectionId?: string
    metadata?: Record<string, unknown>
  }) => Promise<WebhookHandler>
  updateWebhookHandler: (
    handlerId: string,
    updates: {
      externalWebhookId?: string
      metadata?: Record<string, unknown>
    }
  ) => Promise<void>
  deleteWebhookHandler: (handlerId: string) => Promise<void>
  listWebhookHandlers: () => Promise<WebhookHandler[]>
  getOrganizationSetting: (key: string) => Promise<any | undefined>
  getOrganizationSettings: () => Promise<Record<string, any>>
  setOrganizationSetting: (key: string, value: any) => Promise<void>
  setOrganizationSettings: (settings: Record<string, any>) => Promise<void>
  // Entity value I/O (app-owned custom fields). Backed by /api/v1/sdk/entities.
  setFieldValues: (
    recordIdOrEntries: string | Array<{ recordId: string; values: Record<string, unknown> }>,
    values?: Record<string, unknown>
  ) => Promise<void>
  getFieldValue: (recordId: string, fieldKey: string) => Promise<unknown | null>
  getFieldValues: (
    recordId: string,
    fieldKeys?: string[]
  ) => Promise<Record<string, unknown | null>>
  findRecordByFieldValue: (input: {
    targetEntity: string
    fieldKey: string
    value: string
  }) => Promise<{ recordId: string; displayName: string | null } | null>
  findByIntegrationId: (input: {
    kind: string
    source: string
    externalId: string
  }) => Promise<{ recordId: string; displayName: string | null } | null>
  findContactByEmail: (input: {
    email: string
  }) => Promise<{ recordId: string; displayName: string | null } | null>
  findContactByPhone: (input: {
    phone: string
  }) => Promise<{ recordId: string; displayName: string | null } | null>
}

/**
 * Server SDK fetch options
 *
 * Configuration for making HTTP requests via the SDK fetch method.
 * Provides timeout support and automatic request/response handling.
 *
 * @interface ServerSDKFetchOptions
 * @property {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @property {string} url - Full URL to request
 * @property {Record<string, string>} [headers] - Optional HTTP headers
 * @property {unknown} [body] - Optional request body (will be JSON stringified)
 * @property {number} [timeout] - Optional timeout in milliseconds (default: 30000)
 *
 * @example
 * ```typescript
 * const options: ServerSDKFetchOptions = {
 *   method: 'POST',
 *   url: 'https://api.github.com/repos/owner/repo/issues',
 *   headers: {
 *     'Authorization': 'Bearer token123',
 *     'Content-Type': 'application/json'
 *   },
 *   body: {
 *     title: 'Bug report',
 *     body: 'Something is broken'
 *   },
 *   timeout: 10000
 * }
 * ```
 */
export interface ServerSDKFetchOptions {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeout?: number
}

/**
 * Server SDK fetch response
 *
 * Response from SDK fetch method including status, headers, and parsed data.
 *
 * @interface ServerSDKFetchResponse
 * @property {number} status - HTTP status code
 * @property {Record<string, string>} headers - Response headers
 * @property {unknown} data - Parsed response body (automatically JSON parsed)
 *
 * @example
 * ```typescript
 * const response: ServerSDKFetchResponse = {
 *   status: 200,
 *   headers: {
 *     'content-type': 'application/json',
 *     'x-ratelimit-remaining': '4999'
 *   },
 *   data: {
 *     id: 123,
 *     name: 'John Doe',
 *     email: 'john@example.com'
 *   }
 * }
 * ```
 */
export interface ServerSDKFetchResponse {
  status: number
  headers: Record<string, string>
  data: unknown
}

/**
 * Create Server SDK implementation
 *
 * Creates a ServerSDK instance with runtime context. This SDK provides all
 * the functions that extensions can call via @auxx/sdk/server imports.
 *
 * The SDK is injected as a global (AUXX_SERVER_SDK) before extension code runs.
 *
 * @param {RuntimeContext} context - Runtime execution context
 * @returns {ServerSDK} Fully configured Server SDK instance
 *
 * @example
 * ```typescript
 * import { createServerSDK } from './server-sdk'
 *
 * const context: RuntimeContext = {
 *   user: { id: 'user_123', email: 'user@example.com', name: 'John' },
 *   organization: { id: 'org_456', handle: 'acme', name: 'Acme Inc' },
 *   app: { id: 'app_789', installationId: 'inst_abc' },
 *   apiUrl: 'https://api.auxx.ai',
 *   fetch: globalThis.fetch
 * }
 *
 * const sdk = createServerSDK(context)
 *
 * // Now extension code can use SDK methods
 * const user = sdk.getCurrentUser()
 * const response = await sdk.fetch({
 *   method: 'GET',
 *   url: 'https://api.example.com/data'
 * })
 * ```
 */
export function createServerSDK(context: RuntimeContext): ServerSDK {
  /**
   * Build callback headers for SDK → API requests.
   * Uses scoped callback tokens when available, falls back to installation ID only.
   */
  function getCallbackHeaders(scope: 'webhooks' | 'settings' | 'entities'): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-App-Installation-Id': context.app.installationId,
    }
    const token = context.callbackTokens?.[scope]
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  // Create SDK fetch function that will be shared by all SDK methods
  const sdkFetch = async (options: ServerSDKFetchOptions): Promise<ServerSDKFetchResponse> => {
    console.log('[ServerSDK] fetch:', options.method, options.url)

    // Use fetch from context (captured from outer scope) instead of globalThis.fetch
    // This ensures network access works inside the Function() sandbox
    const controller = new AbortController()
    const timeout = options.timeout || 30000

    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await context.fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const data = await response.json()

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      }
    } catch (error: unknown) {
      clearTimeout(timeoutId)

      const { message } = parseError(error)
      if (
        message.includes('AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new Error(`Request timeout after ${timeout}ms`)
      }

      throw error
    }
  }

  return {
    /**
     * Get current authenticated user.
     * Maps to getCurrentUser() from @auxx/sdk/server
     */
    getCurrentUser: () => {
      return {
        id: context.user.id,
        email: context.user.email,
        name: context.user.name || context.user.email?.split('@')[0] || '',
        avatar: undefined,
        role: undefined,
      }
    },

    /**
     * Get API token for making authenticated requests.
     * Maps to getApiToken() from @auxx/sdk/server
     */
    getApiToken: () => {
      // TODO Phase 2: Generate short-lived JWT for extension
      throw new Error('API tokens not yet implemented')
    },

    /**
     * Execute database query.
     * Maps to query() from @auxx/sdk/server
     */
    query: (_options: { sql: string; params?: unknown[] }) => {
      // TODO Phase 2: Execute query via platform API
      // Extensions should NOT have direct database access
      throw new Error('Database queries not yet implemented')
    },

    /**
     * Make HTTP request to external API.
     * Maps to fetch() from @auxx/sdk/server
     *
     * Note: This wraps native fetch with rate limiting and logging.
     */
    fetch: sdkFetch,

    /**
     * Store data in extension storage.
     * Maps to storage functions from @auxx/sdk/server
     */
    storage: {
      get: (_key: string) => {
        // TODO Phase 2: Implement storage via platform API
        throw new Error('Storage not yet implemented')
      },
      set: (_key: string, _value: unknown) => {
        // TODO Phase 2: Implement storage via platform API
        throw new Error('Storage not yet implemented')
      },
      delete: (_key: string) => {
        // TODO Phase 2: Implement storage via platform API
        throw new Error('Storage not yet implemented')
      },
    },

    /**
     * Workflow functions (for workflow block handlers).
     */
    workflow: {
      // TODO Phase 3: Implement workflow SDK functions
    },

    /**
     * Get user connection to external service.
     * Throws ConnectionNotFoundError if not connected.
     */
    getUserConnection: (): Connection | undefined => {
      console.log('[ServerSDK] getUserConnection')

      if (!context.userConnection) {
        return undefined
      }

      // Check if token is expired (for OAuth2)
      if (context.userConnection.expiresAt) {
        const expiresAt = new Date(context.userConnection.expiresAt)
        const now = new Date()

        if (expiresAt < now) {
          // Token expired - platform should have refreshed before calling lambda
          console.error('[ServerSDK] User connection token expired', {
            expiresAt: context.userConnection.expiresAt,
            now: now.toISOString(),
          })
          const error = new Error(
            'Connection token expired. Please reconnect your account.'
          ) as Error & { code: string; scope: string }
          error.code = 'CONNECTION_EXPIRED'
          error.scope = 'user'
          throw error
        }
      }

      return {
        id: context.userConnection.id,
        type: context.userConnection.type,
        value: context.userConnection.value,
        metadata: context.userConnection.metadata,
        expiresAt: context.userConnection.expiresAt
          ? new Date(context.userConnection.expiresAt)
          : undefined,
      }
    },

    /**
     * Get organization connection to external service.
     * Throws ConnectionNotFoundError if not connected.
     */
    getOrganizationConnection: (): Connection | undefined => {
      console.log('[ServerSDK] getOrganizationConnection')
      if (!context.organizationConnection) {
        return undefined
      }

      // Check if token is expired (for OAuth2)
      if (context.organizationConnection.expiresAt) {
        const expiresAt = new Date(context.organizationConnection.expiresAt)
        const now = new Date()

        if (expiresAt < now) {
          console.error('[ServerSDK] Organization connection token expired', {
            expiresAt: context.organizationConnection.expiresAt,
            now: now.toISOString(),
          })
          const error = new Error(
            'Connection token expired. Please reconnect your workspace account.'
          ) as Error & { code: string; scope: string }
          error.code = 'CONNECTION_EXPIRED'
          error.scope = 'organization'
          throw error
        }
      }

      return {
        id: context.organizationConnection.id,
        type: context.organizationConnection.type,
        value: context.organizationConnection.value,
        metadata: context.organizationConnection.metadata,
        expiresAt: context.organizationConnection.expiresAt
          ? new Date(context.organizationConnection.expiresAt)
          : undefined,
      }
    },

    /**
     * Get the connection bound to this invocation, regardless of scope. The
     * platform decides whether to inject the workspace cred or the user cred
     * (e.g. via an agent's `appAccounts[appId].credId` binding) before
     * calling into the lambda. Tool authors should prefer this over the
     * split helpers — see plans/kopilot/apps/agent-credentials.md §6.2.
     */
    getConnection: (): Connection | undefined => {
      console.log('[ServerSDK] getConnection')
      const conn = context.organizationConnection ?? context.userConnection
      if (!conn) return undefined

      if (conn.expiresAt) {
        const expiresAt = new Date(conn.expiresAt)
        if (expiresAt < new Date()) {
          const error = new Error(
            'Connection token expired. Please reconnect your account.'
          ) as Error & { code: string; scope: string }
          error.code = 'CONNECTION_EXPIRED'
          error.scope = context.organizationConnection ? 'organization' : 'user'
          throw error
        }
      }

      return {
        id: conn.id,
        type: conn.type,
        value: conn.value,
        metadata: conn.metadata,
        expiresAt: conn.expiresAt ? new Date(conn.expiresAt) : undefined,
      }
    },

    /**
     * Create webhook handler implementation
     */
    createWebhookHandler: async (options: {
      fileName: string
      triggerId?: string
      connectionId?: string
      metadata?: Record<string, unknown>
    }): Promise<WebhookHandler> => {
      console.log('[ServerSDK] createWebhookHandler called:', {
        fileName: options.fileName,
        triggerId: options.triggerId,
        connectionId: options.connectionId,
        hasMetadata: !!options.metadata,
      })

      try {
        // Call platform API to create webhook handler
        const response = await sdkFetch({
          method: 'POST',
          url: `${context.apiUrl}/api/v1/sdk/webhooks`,
          headers: getCallbackHeaders('webhooks'),
          body: {
            fileName: options.fileName,
            triggerId: options.triggerId,
            connectionId: options.connectionId,
            metadata: options.metadata,
          },
        })

        if (response.status !== 200) {
          console.error('[ServerSDK] createWebhookHandler failed:', {
            status: response.status,
            data: response.data,
          })
          throw new Error(`Failed to create webhook handler: ${response.status}`)
        }

        // Extract data from standard response format
        const responseData = response.data as { success: boolean; data: WebhookHandler }
        console.log('[ServerSDK] createWebhookHandler succeeded:', {
          id: responseData.data.id,
          url: responseData.data.url,
        })
        return responseData.data
      } catch (error) {
        console.error('[ServerSDK] createWebhookHandler error:', error)
        throw error
      }
    },

    /**
     * Update webhook handler implementation
     */
    updateWebhookHandler: async (
      handlerId: string,
      updates: { externalWebhookId?: string; metadata?: Record<string, unknown> }
    ): Promise<void> => {
      console.log('[ServerSDK] updateWebhookHandler:', handlerId, updates)

      const response = await sdkFetch({
        method: 'PATCH',
        url: `${context.apiUrl}/api/v1/sdk/webhooks/${handlerId}`,
        headers: getCallbackHeaders('webhooks'),
        body: updates,
      })

      if (response.status !== 200) {
        throw new Error(`Failed to update webhook handler: ${response.status}`)
      }
    },

    /**
     * Delete webhook handler implementation
     */
    deleteWebhookHandler: async (handlerId: string): Promise<void> => {
      console.log('[ServerSDK] deleteWebhookHandler:', handlerId)

      const response = await sdkFetch({
        method: 'DELETE',
        url: `${context.apiUrl}/api/v1/sdk/webhooks/${handlerId}`,
        headers: getCallbackHeaders('webhooks'),
      })

      if (response.status !== 200) {
        throw new Error(`Failed to delete webhook handler: ${response.status}`)
      }
    },

    /**
     * List webhook handlers implementation
     */
    listWebhookHandlers: async (): Promise<WebhookHandler[]> => {
      console.log('[ServerSDK] listWebhookHandlers called')

      try {
        const response = await sdkFetch({
          method: 'GET',
          url: `${context.apiUrl}/api/v1/sdk/webhooks`,
          headers: getCallbackHeaders('webhooks'),
        })

        if (response.status !== 200) {
          console.error('[ServerSDK] listWebhookHandlers failed:', {
            status: response.status,
            data: response.data,
          })
          throw new Error(`Failed to list webhook handlers: ${response.status}`)
        }

        // Extract data from standard response format
        const responseData = response.data as { success: boolean; data: WebhookHandler[] }
        console.log('[ServerSDK] listWebhookHandlers succeeded:', {
          count: responseData.data.length,
        })
        return responseData.data
      } catch (error) {
        console.error('[ServerSDK] listWebhookHandlers error:', error)
        throw error
      }
    },

    /**
     * Get a single organization setting value
     */
    getOrganizationSetting: async (key: string): Promise<any | undefined> => {
      console.log('[ServerSDK] getOrganizationSetting:', key)

      try {
        const response = await sdkFetch({
          method: 'GET',
          url: `${context.apiUrl}/api/v1/sdk/settings/${key}`,
          headers: getCallbackHeaders('settings'),
        })

        if (response.status !== 200) {
          console.error('[ServerSDK] getOrganizationSetting failed:', {
            status: response.status,
            data: response.data,
          })
          throw new Error(`Failed to get organization setting: ${response.status}`)
        }

        const responseData = response.data as { success: boolean; data: { value: any } }
        return responseData.data.value
      } catch (error) {
        console.error('[ServerSDK] getOrganizationSetting error:', error)
        throw error
      }
    },

    /**
     * Get all organization settings
     */
    getOrganizationSettings: async (): Promise<Record<string, any>> => {
      console.log('[ServerSDK] getOrganizationSettings called')

      try {
        const response = await sdkFetch({
          method: 'GET',
          url: `${context.apiUrl}/api/v1/sdk/settings`,
          headers: getCallbackHeaders('settings'),
        })

        if (response.status !== 200) {
          console.error('[ServerSDK] getOrganizationSettings failed:', {
            status: response.status,
            data: response.data,
          })
          throw new Error(`Failed to get organization settings: ${response.status}`)
        }

        const responseData = response.data as { success: boolean; data: Record<string, any> }
        return responseData.data
      } catch (error) {
        console.error('[ServerSDK] getOrganizationSettings error:', error)
        throw error
      }
    },

    /**
     * Set a single organization setting value
     */
    setOrganizationSetting: async (key: string, value: any): Promise<void> => {
      console.log('[ServerSDK] setOrganizationSetting:', key, value)

      try {
        const response = await sdkFetch({
          method: 'PUT',
          url: `${context.apiUrl}/api/v1/sdk/settings/${key}`,
          headers: getCallbackHeaders('settings'),
          body: { value },
        })

        if (response.status !== 200) {
          console.error('[ServerSDK] setOrganizationSetting failed:', {
            status: response.status,
            data: response.data,
          })
          throw new Error(`Failed to set organization setting: ${response.status}`)
        }
      } catch (error) {
        console.error('[ServerSDK] setOrganizationSetting error:', error)
        throw error
      }
    },

    /**
     * Set multiple organization settings at once
     */
    setOrganizationSettings: async (settings: Record<string, any>): Promise<void> => {
      console.log('[ServerSDK] setOrganizationSettings called:', Object.keys(settings))

      try {
        const response = await sdkFetch({
          method: 'POST',
          url: `${context.apiUrl}/api/v1/sdk/settings`,
          headers: getCallbackHeaders('settings'),
          body: { settings },
        })

        if (response.status !== 200) {
          console.error('[ServerSDK] setOrganizationSettings failed:', {
            status: response.status,
            data: response.data,
          })
          throw new Error(`Failed to set organization settings: ${response.status}`)
        }
      } catch (error) {
        console.error('[ServerSDK] setOrganizationSettings error:', error)
        throw error
      }
    },

    // ── Entity value I/O (app-owned custom fields) ──

    /**
     * Write field values for one record (map form) or many records (entries
     * form). The app may only write fields it owns; the route enforces (403).
     */
    setFieldValues: async (
      recordIdOrEntries: string | Array<{ recordId: string; values: Record<string, unknown> }>,
      values?: Record<string, unknown>
    ): Promise<void> => {
      const body =
        typeof recordIdOrEntries === 'string'
          ? { entries: [{ recordId: recordIdOrEntries, values: values ?? {} }] }
          : { entries: recordIdOrEntries }

      const response = await sdkFetch({
        method: 'POST',
        url: `${context.apiUrl}/api/v1/sdk/entities/set-values`,
        headers: getCallbackHeaders('entities'),
        body,
      })
      if (response.status !== 200) {
        console.error('[ServerSDK] setFieldValues failed:', {
          status: response.status,
          data: response.data,
        })
        throw new Error(`Failed to set field values: ${response.status}`)
      }
    },

    /** Read a single owned field's value for a record (null when unset). */
    getFieldValue: async (recordId: string, fieldKey: string): Promise<unknown | null> => {
      const response = await sdkFetch({
        method: 'POST',
        url: `${context.apiUrl}/api/v1/sdk/entities/get-values`,
        headers: getCallbackHeaders('entities'),
        body: { recordId, fieldKeys: [fieldKey] },
      })
      if (response.status !== 200) {
        throw new Error(`Failed to get field value: ${response.status}`)
      }
      const data = response.data as { values: Record<string, unknown | null> }
      return data.values?.[fieldKey] ?? null
    },

    /** Read owned field values for a record. Omit `fieldKeys` for all owned. */
    getFieldValues: async (
      recordId: string,
      fieldKeys?: string[]
    ): Promise<Record<string, unknown | null>> => {
      const response = await sdkFetch({
        method: 'POST',
        url: `${context.apiUrl}/api/v1/sdk/entities/get-values`,
        headers: getCallbackHeaders('entities'),
        body: { recordId, fieldKeys },
      })
      if (response.status !== 200) {
        throw new Error(`Failed to get field values: ${response.status}`)
      }
      const data = response.data as { values: Record<string, unknown | null> }
      return data.values ?? {}
    },

    /** Reverse lookup: which record holds this value on an owned field? */
    findRecordByFieldValue: async (input: {
      targetEntity: string
      fieldKey: string
      value: string
    }): Promise<{ recordId: string; displayName: string | null } | null> => {
      const response = await sdkFetch({
        method: 'POST',
        url: `${context.apiUrl}/api/v1/sdk/entities/find-by-value`,
        headers: getCallbackHeaders('entities'),
        body: input,
      })
      if (response.status !== 200) {
        throw new Error(`Failed to find record by value: ${response.status}`)
      }
      const data = response.data as {
        entity: { recordId: string; displayName: string | null } | null
      }
      return data.entity ?? null
    },

    /** Resolve a record by its integration external id. */
    findByIntegrationId: async (input: {
      kind: string
      source: string
      externalId: string
    }): Promise<{ recordId: string; displayName: string | null } | null> => {
      const response = await sdkFetch({
        method: 'POST',
        url: `${context.apiUrl}/api/v1/sdk/entities/find-by-integration-id`,
        headers: getCallbackHeaders('entities'),
        body: input,
      })
      if (response.status !== 200) {
        throw new Error(`Failed to find by integration id: ${response.status}`)
      }
      const data = response.data as {
        entity: { recordId: string; displayName: string | null } | null
      }
      return data.entity ?? null
    },

    /** Resolve a contact by primary email. */
    findContactByEmail: async (input: {
      email: string
    }): Promise<{ recordId: string; displayName: string | null } | null> => {
      const response = await sdkFetch({
        method: 'POST',
        url: `${context.apiUrl}/api/v1/sdk/entities/find-contact-by-email`,
        headers: getCallbackHeaders('entities'),
        body: input,
      })
      if (response.status !== 200) {
        throw new Error(`Failed to find contact by email: ${response.status}`)
      }
      const data = response.data as {
        entity: { recordId: string; displayName: string | null } | null
      }
      return data.entity ?? null
    },

    /** Resolve a contact by primary phone (normalized server-side). */
    findContactByPhone: async (input: {
      phone: string
    }): Promise<{ recordId: string; displayName: string | null } | null> => {
      const response = await sdkFetch({
        method: 'POST',
        url: `${context.apiUrl}/api/v1/sdk/entities/find-contact-by-phone`,
        headers: getCallbackHeaders('entities'),
        body: input,
      })
      if (response.status !== 200) {
        throw new Error(`Failed to find contact by phone: ${response.status}`)
      }
      const data = response.data as {
        entity: { recordId: string; displayName: string | null } | null
      }
      return data.entity ?? null
    },
  }
}
