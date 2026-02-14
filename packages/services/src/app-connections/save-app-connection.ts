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
  })

  // First try to find existing connection
  const existingResult = await fromDatabase(
    database.query.WorkflowCredentials.findFirst({
      where: (creds, { eq, and, isNull }) => {
        const conditions = [
          eq(creds.appId, appId),
          eq(creds.organizationId, organizationId),
          eq(creds.type, 'app-connection'),
        ]

        if (userId) {
          conditions.push(eq(creds.userId, userId))
        } else {
          conditions.push(isNull(creds.userId))
        }

        return and(...conditions)
      },
      columns: {
        id: true,
      },
    }),
    'find-existing-connection'
  )

  if (existingResult.isErr()) {
    return existingResult
  }

  const existing = existingResult.value

  if (existing) {
    // Update existing connection
    logger.info('Updating existing app connection:', { credentialId: existing.id })

    // Parse expiresAt for database field (duplicate from encrypted data for querying)
    const expiresAt = connectionData.expiresAt ? new Date(connectionData.expiresAt) : null

    const updateResult = await fromDatabase(
      database
        .update(schema.WorkflowCredentials)
        .set({
          encryptedData: encrypted,
          expiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(schema.WorkflowCredentials.id, existing.id)),
      'update-connection'
    )

    if (updateResult.isErr()) {
      return updateResult
    }

    logger.info('Successfully updated app connection:', { credentialId: existing.id })
    return ok(existing.id)
  }

  // Create new connection
  logger.info('Creating new app connection')

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
