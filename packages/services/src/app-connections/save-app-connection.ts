// packages/services/src/app-connections/save-app-connection.ts

import { CredentialService } from '@auxx/credentials'
import { database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { triggerAppEvent } from '../app-events'
import { fromDatabase } from '../shared/utils'
import { logger, safeSerializeMetadata } from './utils'

/**
 * Save app connection (OAuth callback or manual secret)
 *
 * Creates or updates an app connection with encrypted credentials. This function implements
 * an upsert pattern - it will update an existing connection if one exists for the same
 * app/organization/user combination, or create a new one if not.
 *
 * The function handles two primary use cases:
 * 1. OAuth2 flow completion: Saves access_token, refresh_token, and expiry from OAuth callback
 * 2. Manual secret entry: Saves API keys or secrets entered directly by the user
 *
 * All sensitive credential data is encrypted using the CredentialService before being
 * stored in the database. The function also triggers a 'connection-added' app event
 * (for new connections) to notify any registered event handlers in the app.
 *
 * Connection scoping:
 * - If userId is null: Creates an organization-scoped connection (shared across all users)
 * - If userId is provided: Creates a user-scoped connection (specific to that user)
 *
 * @param {string} appId - The unique identifier of the app.
 * @param {string} appInstallationId - The unique identifier of the app installation.
 *                                     Used for triggering app events.
 * @param {string} appName - Human-readable name of the app (e.g., "Gmail", "Shopify").
 *                           Used to generate the credential name.
 * @param {string} organizationId - The unique identifier of the organization.
 *                                  Required for access control and encryption.
 * @param {string} createdById - The unique identifier of the user creating/updating the connection.
 *                               Used for audit trails.
 * @param {string | null} userId - The user ID for user-scoped connections, or null for org-scoped.
 *                                 - null: Connection shared across all users in the organization
 *                                 - string: Connection specific to this user
 * @param {Object} connectionData - The credential data to encrypt and store.
 * @param {string} [connectionData.accessToken] - OAuth2 access token (for OAuth connections).
 * @param {string} [connectionData.refreshToken] - OAuth2 refresh token (for OAuth connections).
 * @param {string} [connectionData.expiresAt] - ISO 8601 timestamp when access token expires.
 * @param {string} [connectionData.secret] - API key or secret (for secret-based connections).
 * @param {Record<string, any>} [connectionData.metadata] - Additional metadata like scopes,
 *                                                          token type, user info, etc.
 *
 * @returns {Promise<Result<string, Error>>}
 *          A Result containing either:
 *          - Success: The credential ID (string) of the created or updated connection
 *          - Error: Database error or CONNECTION_CREATE_FAILED if creation fails
 *
 * @example
 * // Save OAuth2 connection after callback
 * const result = await saveAppConnection(
 *   'gmail-app-id',
 *   'installation-123',
 *   'Gmail',
 *   'org-456',
 *   'user-789',
 *   'user-789', // User-scoped connection
 *   {
 *     accessToken: 'ya29.a0...',
 *     refreshToken: '1//0e...',
 *     expiresAt: '2024-01-15T10:30:00Z',
 *     metadata: { scope: 'https://www.googleapis.com/auth/gmail.send' }
 *   }
 * )
 *
 * @example
 * // Save API secret for organization
 * const result = await saveAppConnection(
 *   'shopify-app-id',
 *   'installation-456',
 *   'Shopify',
 *   'org-123',
 *   'admin-user-id',
 *   null, // Organization-scoped connection
 *   {
 *     secret: 'shpat_abc123...',
 *     metadata: { shopUrl: 'mystore.myshopify.com' }
 *   }
 * )
 */
export async function saveAppConnection(
  appId: string,
  appInstallationId: string,
  appName: string,
  organizationId: string,
  createdById: string,
  userId: string | null,
  connectionData: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
    secret?: string
    metadata?: Record<string, any>
  },
  options?: {
    label?: string
    connectionId?: string
  }
) {
  const credentialName = `${appName} Connection`
  const encrypted = CredentialService.encrypt(connectionData as any)
  const now = new Date()

  logger.info('saveAppConnection called with:', {
    appId,
    appInstallationId,
    appName,
    organizationId,
    createdById,
    userId,
    hasAccess: !!connectionData.accessToken,
    hasRefresh: !!connectionData.refreshToken,
    expiresAt: connectionData.expiresAt,
    connectionId: options?.connectionId,
  })

  // If connectionId provided, update that specific connection (reconnect flow)
  if (options?.connectionId) {
    logger.info('Reconnecting existing app connection:', { credentialId: options.connectionId })

    const expiresAt = connectionData.expiresAt ? new Date(connectionData.expiresAt) : null

    const updateResult = await fromDatabase(
      database
        .update(schema.WorkflowCredentials)
        .set({
          encryptedData: encrypted,
          expiresAt: expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.WorkflowCredentials.id, options.connectionId),
            eq(schema.WorkflowCredentials.organizationId, organizationId)
          )
        ),
      'reconnect-connection'
    )

    if (updateResult.isErr()) {
      return updateResult
    }

    logger.info('Successfully reconnected app connection:', { credentialId: options.connectionId })
    return ok(options.connectionId)
  }

  // Create new connection with auto-generated label
  logger.info('Creating new app connection')

  // Generate auto-increment label
  const label =
    options?.label ||
    (await generateConnectionLabel(appName, organizationId, appId, appInstallationId))

  // Parse expiresAt for database field (duplicate from encrypted data for querying)
  const expiresAt = connectionData.expiresAt ? new Date(connectionData.expiresAt) : null

  const createResult = await fromDatabase(
    database
      .insert(schema.WorkflowCredentials)
      .values({
        organizationId,
        createdById,
        userId,
        appId,
        appInstallationId,
        name: credentialName,
        label,
        type: 'app-connection',
        encryptedData: encrypted,
        expiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.WorkflowCredentials.id }),
    'create-connection'
  )

  if (createResult.isErr()) {
    return createResult
  }

  const [created] = createResult.value

  if (!created) {
    return err({
      code: 'CONNECTION_CREATE_FAILED',
      message: 'Failed to create app connection',
      appId,
      organizationId,
    })
  }

  logger.info('Successfully created app connection:', { credentialId: created.id })

  // Trigger connection-added event
  // Determine connection type based on what data we have
  const connectionType: 'oauth2-code' | 'secret' = connectionData.accessToken
    ? 'oauth2-code'
    : 'secret'
  const connectionValue = connectionData.accessToken || connectionData.secret || ''

  const eventResult = await triggerAppEvent({
    appInstallationId,
    eventType: 'connection-added',
    payload: {
      connection: {
        id: created.id,
        type: connectionType,
        value: connectionValue,
        metadata: safeSerializeMetadata(connectionData.metadata),
      },
    },
  })

  if (eventResult.isErr()) {
    // Log error but don't fail the connection save
    logger.error('Failed to trigger connection-added event', {
      error: eventResult.error.message,
      credentialId: created.id,
    })
  } else {
    logger.info('Triggered connection-added event', { credentialId: created.id })
  }

  return ok(created.id)
}

/**
 * Generate an auto-incrementing connection label.
 * First connection: "AppName", second: "AppName (2)", etc.
 */
async function generateConnectionLabel(
  appName: string,
  organizationId: string,
  appId: string,
  appInstallationId: string
): Promise<string> {
  const existingResult = await fromDatabase(
    database.query.WorkflowCredentials.findMany({
      where: (creds, { eq, and, isNull }) =>
        and(
          eq(creds.organizationId, organizationId),
          eq(creds.appId, appId),
          eq(creds.appInstallationId, appInstallationId),
          eq(creds.type, 'app-connection'),
          isNull(creds.userId)
        ),
      columns: { id: true },
    }),
    'count-existing-connections'
  )

  const count = existingResult.isOk() ? existingResult.value.length : 0
  return count === 0 ? appName : `${appName} (${count + 1})`
}
