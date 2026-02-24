// packages/services/src/app-events/index.ts

import { LAMBDA_API_URL, SERVER_FUNCTION_EXECUTOR_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { DatabaseError } from '../shared/errors'
import { fromDatabase } from '../shared/utils'

const logger = createScopedLogger('app-events')

/**
 * App event error codes
 */
export type AppEventError =
  | DatabaseError
  | {
      code: 'INSTALLATION_NOT_FOUND'
      message: string
      appInstallationId: string
    }
  | {
      code: 'NO_VERSION_INSTALLED'
      message: string
      appInstallationId: string
    }
  | {
      code: 'EVENT_EXECUTION_FAILED'
      message: string
      appInstallationId: string
      eventType: string
      cause?: unknown
    }

/**
 * Connection data for event payload
 *
 * @description
 * Represents a connection object that can be passed to app event handlers.
 * Used when triggering connection-related events (connection-added, connection-removed).
 *
 * @example
 * // OAuth2 connection
 * const oauthConnection: EventConnectionData = {
 *   id: 'conn_123',
 *   type: 'oauth2-code',
 *   value: 'oauth2_access_token_xyz',
 *   metadata: {
 *     scopes: ['read', 'write'],
 *     expiresAt: '2025-12-31T23:59:59Z'
 *   }
 * }
 *
 * @example
 * // Secret/API key connection
 * const secretConnection: EventConnectionData = {
 *   id: 'conn_456',
 *   type: 'secret',
 *   value: 'sk_live_abc123xyz',
 *   metadata: {
 *     environment: 'production'
 *   }
 * }
 */
export interface EventConnectionData {
  /** Unique identifier for the connection */
  id: string
  /** Type of connection authentication */
  type: 'oauth2-code' | 'secret'
  /** The connection credential value (access token, API key, etc.) */
  value: string
  /** Optional metadata associated with the connection */
  metadata?: Record<string, unknown>
}

/**
 * Trigger an app event handler
 *
 * @description
 * Executes an app's server-side event handler by invoking the Lambda executor.
 * This function:
 * 1. Retrieves the app installation and organization details
 * 2. Fetches the app version bundle containing the server code
 * 3. Invokes the Lambda executor with the event payload and context
 * 4. Returns once the event handler completes
 *
 * @param params - Event trigger parameters
 * @param params.appInstallationId - The ID of the app installation to trigger the event for
 * @param params.eventType - The type of event to trigger ('connection-added' | 'connection-removed')
 * @param params.payload - The event payload containing connection data
 * @param params.payload.connection - Connection data to pass to the event handler
 *
 * @returns {Promise<Result<void, AppEventError>>} Result indicating success or failure
 *
 * @example
 * // Trigger connection-added event
 * const result = await triggerAppEvent({
 *   appInstallationId: 'app_inst_123',
 *   eventType: 'connection-added',
 *   payload: {
 *     connection: {
 *       id: 'conn_456',
 *       type: 'oauth2-code',
 *       value: 'oauth2_access_token_xyz',
 *       metadata: {
 *         scopes: ['read', 'write']
 *       }
 *     }
 *   }
 * })
 *
 * if (result.isErr()) {
 *   console.error('Failed to trigger event:', result.error.message)
 * }
 *
 * @example
 * // Trigger connection-removed event
 * const result = await triggerAppEvent({
 *   appInstallationId: 'app_inst_789',
 *   eventType: 'connection-removed',
 *   payload: {
 *     connection: {
 *       id: 'conn_101',
 *       type: 'secret',
 *       value: 'sk_live_removed'
 *     }
 *   }
 * })
 *
 * if (result.isOk()) {
 *   console.log('Event triggered successfully')
 * }
 *
 * @example
 * // Usage in a tRPC mutation
 * const addConnection = api.appConnection.create.useMutation({
 *   onSuccess: async (connection) => {
 *     // Trigger event after connection is created
 *     const result = await triggerAppEvent({
 *       appInstallationId: connection.appInstallationId,
 *       eventType: 'connection-added',
 *       payload: {
 *         connection: {
 *           id: connection.id,
 *           type: connection.type,
 *           value: connection.value,
 *           metadata: connection.metadata
 *         }
 *       }
 *     })
 *
 *     if (result.isErr()) {
 *       throw new Error(`Failed to trigger event: ${result.error.message}`)
 *     }
 *   }
 * })
 */
export async function triggerAppEvent(params: {
  appInstallationId: string
  eventType: 'connection-added' | 'connection-removed'
  payload: {
    connection?: EventConnectionData
  }
}) {
  const { appInstallationId, eventType, payload } = params

  logger.info('Triggering app event', { appInstallationId, eventType })

  // Get app installation with organization
  const installationResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, appInstallationId),
      with: {
        organization: {
          columns: {
            id: true,
            handle: true,
          },
        },
      },
    }),
    'get-app-installation-for-event'
  )

  if (installationResult.isErr()) {
    return err(installationResult.error)
  }

  const installation = installationResult.value

  if (!installation) {
    return err({
      code: 'INSTALLATION_NOT_FOUND' as const,
      message: `App installation not found: ${appInstallationId}`,
      appInstallationId,
    })
  }

  if (!installation.currentVersionId) {
    return err({
      code: 'NO_VERSION_INSTALLED' as const,
      message: `App installation has no current version: ${appInstallationId}`,
      appInstallationId,
    })
  }

  // Get version bundle
  const bundleResult = await fromDatabase(
    database
      .select()
      .from(schema.AppVersionBundle)
      .where(eq(schema.AppVersionBundle.appVersionId, installation.currentVersionId))
      .limit(1),
    'get-version-bundle-for-event'
  )

  if (bundleResult.isErr()) {
    return err(bundleResult.error)
  }

  const [versionBundle] = bundleResult.value

  if (!versionBundle?.serverBundleS3Key) {
    // No server bundle - app doesn't have event handlers
    logger.info('No server bundle for app, skipping event', { appInstallationId })
    return ok(undefined)
  }

  // Get Lambda executor URL and API URL from environment
  const executorUrl = SERVER_FUNCTION_EXECUTOR_URL

  // Invoke Lambda via HTTP (works in dev AND production)
  try {
    const response = await fetch(executorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        bundleKey: versionBundle.serverBundleS3Key,
        eventType,
        eventPayload: payload,
        context: {
          organizationId: installation.organizationId,
          organizationHandle: installation.organization.handle,
          appId: installation.appId,
          appInstallationId,
          apiUrl: LAMBDA_API_URL,
          // Events don't have user context - use system defaults
          userId: 'system',
          userEmail: 'system@auxx.ai',
        },
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      logger.error('Event execution failed', { error, appInstallationId, eventType })
      return err({
        code: 'EVENT_EXECUTION_FAILED' as const,
        message: `Event execution failed: ${error.message || error.error?.message}`,
        appInstallationId,
        eventType,
        cause: error,
      })
    }

    logger.info('Event execution completed', { appInstallationId, eventType })
    return ok(undefined)
  } catch (error) {
    logger.error('Event execution error', { error, appInstallationId, eventType })
    return err({
      code: 'EVENT_EXECUTION_FAILED' as const,
      message: `Event execution error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      appInstallationId,
      eventType,
      cause: error,
    })
  }
}
