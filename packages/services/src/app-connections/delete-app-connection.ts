// packages/services/src/app-connections/delete-app-connection.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { CredentialService } from '@auxx/credentials'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { triggerAppEvent } from '../app-events'
import { logger, safeSerializeMetadata } from './utils'
import type { DecryptedConnectionData } from './types'

/**
 * Delete app connection
 *
 * Removes an app connection from the database and triggers a 'connection-removed' app event
 * to notify any registered event handlers. This function is used when users want to
 * disconnect an app or revoke access.
 *
 * The function performs the following steps:
 * 1. Retrieves the connection details (including encrypted credentials)
 * 2. Deletes the connection record from the database
 * 3. Decrypts the credentials to pass to the app event handler
 * 4. Triggers a 'connection-removed' event so the app can perform cleanup
 *
 * Event triggering allows apps to:
 * - Revoke OAuth tokens with the provider
 * - Clean up any app-side data associated with the connection
 * - Log the disconnection for audit purposes
 *
 * Note: Event trigger failures are logged but do not fail the deletion operation.
 * The connection will be removed from the database regardless of event success.
 *
 * @param {string} credentialId - The unique identifier of the connection to delete.
 *                                This is the WorkflowCredentials.id.
 * @param {string} organizationId - The unique identifier of the organization.
 *                                  Required for access control - ensures users can only
 *                                  delete connections from their own organization.
 *
 * @returns {Promise<Result<undefined, Error>>}
 *          A Result containing either:
 *          - Success: undefined (void result indicating successful deletion)
 *          - Error: Database error or CONNECTION_NOT_FOUND if credential doesn't exist
 *
 * @example
 * // Delete a user's Gmail connection
 * const result = await deleteAppConnection('credential-123', 'org-456')
 * if (result.isOk()) {
 *   console.log('Connection deleted successfully')
 * } else if (result.error.code === 'CONNECTION_NOT_FOUND') {
 *   console.error('Connection not found or already deleted')
 * }
 *
 * @example
 * // Handle deletion with UI feedback
 * const result = await deleteAppConnection(connectionId, orgId)
 * if (result.isOk()) {
 *   toast.success('App disconnected successfully')
 *   refreshConnectionList()
 * } else {
 *   toast.error('Failed to disconnect app')
 * }
 */
export async function deleteAppConnection(credentialId: string, organizationId: string) {
  // First, get the connection details before deleting (for event trigger)
  const connectionResult = await fromDatabase(
    database.query.WorkflowCredentials.findFirst({
      where: (creds, { eq, and }) =>
        and(eq(creds.id, credentialId), eq(creds.organizationId, organizationId)),
      columns: {
        id: true,
        appInstallationId: true,
        encryptedData: true,
      },
    }),
    'get-connection-before-delete'
  )

  if (connectionResult.isErr()) {
    return connectionResult
  }

  const connection = connectionResult.value

  if (!connection) {
    return err({
      code: 'CONNECTION_NOT_FOUND',
      message: 'Connection not found',
      credentialId,
      organizationId,
    })
  }

  // Delete the connection
  const deleteResult = await fromDatabase(
    database
      .delete(schema.WorkflowCredentials)
      .where(
        and(
          eq(schema.WorkflowCredentials.id, credentialId),
          eq(schema.WorkflowCredentials.organizationId, organizationId)
        )
      ),
    'delete-connection'
  )

  if (deleteResult.isErr()) {
    return deleteResult
  }

  // Trigger connection-removed event (if we have appInstallationId)
  if (connection.appInstallationId) {
    // Decrypt connection data to pass to event handler
    const decryptedData = CredentialService.decrypt(
      connection.encryptedData
    ) as DecryptedConnectionData

    const connectionType: 'oauth2-code' | 'secret' = decryptedData.accessToken
      ? 'oauth2-code'
      : 'secret'
    const connectionValue = decryptedData.accessToken || decryptedData.secret || ''

    // Log the metadata before serialization
    logger.info('Connection metadata before serialization', {
      credentialId: connection.id,
      metadataKeys: decryptedData.metadata ? Object.keys(decryptedData.metadata) : [],
      metadata: decryptedData.metadata,
    })

    const serializedMetadata = safeSerializeMetadata(decryptedData.metadata)

    // Log the serialized metadata
    logger.info('Serialized metadata for event', {
      credentialId: connection.id,
      serializedMetadata,
      serializedMetadataKeys: serializedMetadata ? Object.keys(serializedMetadata) : [],
    })

    const eventPayload = {
      connection: {
        id: connection.id,
        type: connectionType,
        value: connectionValue,
        metadata: serializedMetadata,
      },
    }

    // Log the full event payload
    logger.info('Triggering connection-removed event with payload', {
      appInstallationId: connection.appInstallationId,
      payload: eventPayload,
      payloadStringLength: JSON.stringify(eventPayload).length,
    })

    const eventResult = await triggerAppEvent({
      appInstallationId: connection.appInstallationId,
      eventType: 'connection-removed',
      payload: eventPayload,
    })

    if (eventResult.isErr()) {
      // Log error but don't fail the connection delete
      logger.error('Failed to trigger connection-removed event', {
        error: eventResult.error.message,
        credentialId,
      })
    } else {
      logger.info('Triggered connection-removed event', { credentialId })
    }
  }

  return ok(undefined)
}
