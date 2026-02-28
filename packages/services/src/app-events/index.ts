// packages/services/src/app-events/index.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { invokeLambdaExecutor, prepareLambdaContext } from '../lambda-execution'
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
 * Executes an app's server-side event handler by invoking the Lambda executor
 * through the shared `invokeLambdaExecutor()` helper with HMAC signing.
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

  // Build context and invoke Lambda via shared helper
  const context = prepareLambdaContext({
    appId: installation.appId,
    installationId: appInstallationId,
    organizationId: installation.organizationId,
    organizationHandle: installation.organization.handle,
    userId: 'system',
    userEmail: 'system@auxx.ai',
    userName: null,
  })

  const lambdaResult = await invokeLambdaExecutor({
    caller: 'app-events',
    payload: {
      type: 'event',
      bundleKey: versionBundle.serverBundleS3Key,
      eventType,
      eventPayload: payload,
      context,
    },
  })

  if (lambdaResult.isErr()) {
    const error = lambdaResult.error
    logger.error('Event execution failed', { error, appInstallationId, eventType })
    return err({
      code: 'EVENT_EXECUTION_FAILED' as const,
      message: `Event execution failed: ${error.message}`,
      appInstallationId,
      eventType,
      cause: error,
    })
  }

  logger.info('Event execution completed', { appInstallationId, eventType })
  return ok(undefined)
}
