// packages/services/src/app-connections/resolve-app-connection-for-runtime.ts

import { CredentialService } from '@auxx/credentials'
import { database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { DecryptedConnectionData, RuntimeConnectionData } from './types'
import { logger } from './utils'

/**
 * Resolve app connections for runtime execution
 *
 * Fetches and decrypts both user-scoped and organization-scoped connections for an app,
 * preparing them for use in the runtime execution environment. This is a comprehensive
 * connection resolver that provides the runtime with all available connections based on
 * the app's connection definitions.
 *
 * Unlike `getAppConnection()` which returns only one connection (with user fallback to org),
 * this function returns BOTH connection types separately, allowing the runtime to:
 * - Pass user-specific credentials to user-scoped functions
 * - Pass organization credentials to org-scoped functions
 * - Let the app decide which connection to use in different contexts
 *
 * The resolution process:
 * 1. Queries connection definitions to determine what connection types the app supports
 * 2. If app has user-scoped definition (global: false), fetches and decrypts user connection
 * 3. If app has org-scoped definition (global: true), fetches and decrypts org connection
 * 4. Returns both connections (either may be undefined if not configured)
 *
 * Connection availability scenarios:
 * - App supports both types: Both connections returned (if configured)
 * - App supports only user type: Only userConnection returned
 * - App supports only org type: Only organizationConnection returned
 * - Neither configured: Both undefined (app functions will fail without connections)
 *
 * This function is called by the lambda runtime before executing app code to ensure
 * all necessary credentials are available in the execution context.
 *
 * @param {Object} input - The resolution parameters
 * @param {string} input.appId - The unique identifier of the app needing connections.
 * @param {string} input.organizationId - The unique identifier of the organization.
 *                                        Used for access control and decryption.
 * @param {string} input.userId - The unique identifier of the user executing the app.
 *                                Used to fetch user-scoped connections.
 * @param {number} input.versionMajor - The major version of the app (e.g., 1 for v1.2.3).
 *                                      Connection definitions are versioned with the app.
 *
 * @returns {Promise<Result<{ userConnection?: RuntimeConnectionData, organizationConnection?: RuntimeConnectionData }, Error>>}
 *          A Result containing either:
 *          - Success: Object with optional userConnection and organizationConnection
 *          - Error: DATABASE_ERROR if queries fail, or DECRYPTION_ERROR if decryption fails
 *
 * @example
 * // Resolve connections for Gmail app execution
 * const result = await resolveAppConnectionForRuntime({
 *   appId: 'gmail-app-id',
 *   organizationId: 'org-123',
 *   userId: 'user-456',
 *   versionMajor: 1
 * })
 *
 * if (result.isOk()) {
 *   const { userConnection, organizationConnection } = result.value
 *
 *   if (userConnection) {
 *     // Use personal Gmail account for user-specific functions
 *     console.log('User Gmail:', userConnection.value)
 *   }
 *
 *   if (organizationConnection) {
 *     // Use company Gmail account for org-wide functions
 *     console.log('Org Gmail:', organizationConnection.value)
 *   }
 * }
 *
 * @example
 * // Handle missing connections
 * const result = await resolveAppConnectionForRuntime(input)
 * if (result.isOk()) {
 *   const { userConnection, organizationConnection } = result.value
 *
 *   if (!userConnection && !organizationConnection) {
 *     throw new Error('No connections configured for this app')
 *   }
 *
 *   // Use whichever is available
 *   const connection = userConnection || organizationConnection
 *   await executeAppFunction(connection)
 * }
 */
export async function resolveAppConnectionForRuntime(input: {
  appId: string
  organizationId: string
  userId: string
  versionMajor: number
}) {
  const { appId, organizationId, userId, versionMajor } = input

  logger.info('resolveAppConnectionForRuntime', { appId, organizationId, userId, versionMajor })

  // 1. Get connection definitions for this app version
  // Try user-scoped first (global: false)
  const userConnDefResult = await fromDatabase(
    database.query.ConnectionDefinition.findFirst({
      where: (connDef, { eq, and }) =>
        and(eq(connDef.appId, appId), eq(connDef.major, versionMajor), eq(connDef.global, false)),
      columns: {
        id: true,
        connectionType: true,
      },
    }),
    'get-user-connection-definition'
  )

  if (userConnDefResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to query user connection definition',
    })
  }

  // Try organization-scoped (global: true)
  const orgConnDefResult = await fromDatabase(
    database.query.ConnectionDefinition.findFirst({
      where: (connDef, { eq, and }) =>
        and(eq(connDef.appId, appId), eq(connDef.major, versionMajor), eq(connDef.global, true)),
      columns: {
        id: true,
        connectionType: true,
      },
    }),
    'get-org-connection-definition'
  )

  if (orgConnDefResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to query organization connection definition',
    })
  }

  const userConnDef = userConnDefResult.value
  const orgConnDef = orgConnDefResult.value

  let userConnection: RuntimeConnectionData | undefined
  let organizationConnection: RuntimeConnectionData | undefined

  // 2. Fetch user connection (if app has user-scoped definition)
  if (userConnDef) {
    const userCredResult = await fromDatabase(
      database.query.WorkflowCredentials.findFirst({
        where: (creds, { eq, and }) =>
          and(
            eq(creds.appId, appId),
            eq(creds.organizationId, organizationId),
            eq(creds.userId, userId),
            eq(creds.type, 'app-connection')
          ),
      }),
      'get-user-credential'
    )

    if (userCredResult.isErr()) {
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to query user credential',
      })
    }

    const userCred = userCredResult.value

    if (userCred) {
      try {
        // Decrypt using CredentialService
        const decryptedData = CredentialService.decrypt(
          userCred.encryptedData
        ) as DecryptedConnectionData

        console.log('[ResolveConnection] User connection metadata:', decryptedData.metadata)

        userConnection = {
          id: userCred.id,
          type: userConnDef.connectionType as 'oauth2-code' | 'secret',
          value: decryptedData.accessToken || decryptedData.secret || '',
          metadata: decryptedData.metadata,
          expiresAt: decryptedData.expiresAt,
        }

        logger.info('User connection resolved', { credentialId: userCred.id })
      } catch (error) {
        logger.error('Failed to decrypt user credential', { error, credentialId: userCred.id })
        return err({
          code: 'DECRYPTION_ERROR',
          message: 'Failed to decrypt user credential',
        })
      }
    }
  }

  // 3. Fetch organization connection (if app has org-scoped definition)
  if (orgConnDef) {
    const orgCredResult = await fromDatabase(
      database.query.WorkflowCredentials.findFirst({
        where: (creds, { eq, and, isNull }) =>
          and(
            eq(creds.appId, appId),
            eq(creds.organizationId, organizationId),
            isNull(creds.userId), // Organization connection has no userId
            eq(creds.type, 'app-connection')
          ),
      }),
      'get-org-credential'
    )

    if (orgCredResult.isErr()) {
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to query organization credential',
      })
    }

    const orgCred = orgCredResult.value

    if (orgCred) {
      try {
        const decryptedData = CredentialService.decrypt(
          orgCred.encryptedData
        ) as DecryptedConnectionData

        console.log('[ResolveConnection] Org connection metadata:', decryptedData.metadata)

        organizationConnection = {
          id: orgCred.id,
          type: orgConnDef.connectionType as 'oauth2-code' | 'secret',
          value: decryptedData.accessToken || decryptedData.secret || '',
          metadata: decryptedData.metadata,
          expiresAt: decryptedData.expiresAt,
        }

        logger.info('Organization connection resolved', { credentialId: orgCred.id })
      } catch (error) {
        logger.error('Failed to decrypt organization credential', {
          error,
          credentialId: orgCred.id,
        })
        return err({
          code: 'DECRYPTION_ERROR',
          message: 'Failed to decrypt organization credential',
        })
      }
    }
  }

  return ok({ userConnection, organizationConnection })
}
