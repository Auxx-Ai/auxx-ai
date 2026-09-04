// packages/lib/src/apps/connections/delete-app-connection.ts

import { deleteCredential, revealSecrets } from '@auxx/credentials/store'
import { database, schema } from '@auxx/database'
import {
  type DecryptedConnectionData,
  logger,
  safeSerializeMetadata,
} from '@auxx/services/app-connections'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { disconnectConnectors } from '../../data-connectors/mutations'
import { triggerAppEvent } from '../events'

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
 *                                This is the Credential.id.
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
  // First, get the connection details before deleting (for event trigger). The store reveal
  // gives us the record (appInstallationId, metadata) and the decrypted secrets in one call.
  const revealed = await revealSecrets<DecryptedConnectionData>(credentialId, organizationId)

  if (revealed.isErr()) {
    if (revealed.error.code === 'CREDENTIAL_NOT_FOUND') {
      return err({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Connection not found',
        credentialId,
        organizationId,
      })
    }
    return err(revealed.error)
  }

  const { record: connection, secrets } = revealed.value

  // DISCONNECT every DataConnector this credential backs, before the credential itself
  // goes away (plans/money/tasks/44 D-1). This was a `deleteConnector(…, 'keep')` loop;
  // it must move in lockstep with `uninstall-app.ts`'s, or disconnect quietly becomes
  // the new silent delete for the same connectors uninstall now preserves.
  //
  // What the loop was for still holds and is still handled: without it a disconnect left
  // the connector's mappings pointed at a dead credential and its BullMQ schedule still
  // ticking, failing auth on every run. `disconnectConnectors` tears the schedule down
  // and marks the row, keeping its `DataConnectorItem` bindings for a reconnect.
  try {
    const connectors = await database
      .select({ id: schema.DataConnector.id })
      .from(schema.DataConnector)
      .where(
        and(
          eq(schema.DataConnector.organizationId, organizationId),
          eq(schema.DataConnector.credentialId, credentialId)
        )
      )
    await disconnectConnectors(
      database,
      organizationId,
      connectors.map((c) => c.id),
      'The connection this connector used was removed'
    )
  } catch (error) {
    // A lib module never lets a throw escape as an unhandled rejection — fold it into
    // this function's Result contract like every other failure here.
    logger.error('Failed to disconnect data connector during app disconnect', {
      error: error instanceof Error ? error.message : String(error),
      credentialId,
    })
    return err(error instanceof Error ? error : new Error('Failed to disconnect data connector'))
  }

  // Delete the connection. Connection-scoped app-registered custom fields
  // (CustomField.connectionId → this credential, ON DELETE CASCADE) and their
  // FieldValue rows are removed automatically by the FK cascade — disconnecting
  // one store drops only that store's identity fields (app-registered custom
  // fields §5/§7). No explicit cleanup needed here.
  const deleteResult = await deleteCredential(credentialId, organizationId)

  if (deleteResult.isErr()) {
    return err(deleteResult.error)
  }

  // Trigger connection-removed event (if we have appInstallationId)
  if (connection.appInstallationId) {
    const connectionType: 'oauth2-code' | 'secret' = secrets.accessToken ? 'oauth2-code' : 'secret'
    const connectionValue = secrets.accessToken || secrets.secret || ''

    // Log the metadata before serialization
    logger.info('Connection metadata before serialization', {
      credentialId: connection.id,
      metadataKeys: Object.keys(connection.metadata),
      metadata: connection.metadata,
    })

    const serializedMetadata = safeSerializeMetadata(connection.metadata)

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
