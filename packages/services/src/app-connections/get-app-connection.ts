// packages/services/src/app-connections/get-app-connection.ts

import { database } from '@auxx/database'
import { CredentialService, type NodeData } from '@auxx/credentials'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Get connection for app (used when executing app functions)
 *
 * Retrieves and decrypts the app connection credentials for a specific user and organization.
 * This function implements a fallback hierarchy to maximize connection availability:
 *
 * 1. First attempts to find a user-scoped connection (specific to the userId)
 * 2. If not found, falls back to an organization-scoped connection (shared across all users)
 * 3. Returns error if neither connection type exists
 *
 * This hierarchy allows apps to support both:
 * - Personal user connections (e.g., personal Gmail account)
 * - Shared organization connections (e.g., company Gmail account)
 *
 * The function uses the CredentialService to decrypt the stored credentials, ensuring
 * that sensitive data like OAuth tokens and API secrets are never returned in encrypted form.
 *
 * This function is typically called during:
 * - Workflow execution when an app needs credentials to make API calls
 * - Real-time app function invocations
 * - Background jobs that need to access external APIs
 *
 * @param {string} appId - The unique identifier of the app that needs credentials.
 * @param {string} organizationId - The unique identifier of the organization.
 *                                  Required for access control and credential decryption.
 * @param {string} userId - The unique identifier of the user executing the workflow/function.
 *                          Used to look up user-scoped connections first.
 *
 * @returns {Promise<Result<NodeData, Error>>}
 *          A Result containing either:
 *          - Success: NodeData object with decrypted credentials (accessToken, secret, etc.)
 *          - Error: Database error or CONNECTION_NOT_FOUND if no connection exists
 *
 * @example
 * // Get connection for executing a Gmail send email function
 * const result = await getAppConnection('gmail-app-id', 'org-123', 'user-456')
 * if (result.isOk()) {
 *   const credentials = result.value
 *   // Use credentials.accessToken to call Gmail API
 *   await sendEmail(credentials.accessToken, emailData)
 * } else {
 *   console.error('No Gmail connection found for user')
 * }
 *
 * @example
 * // Handle connection not found error
 * const result = await getAppConnection('shopify-app-id', 'org-123', 'user-789')
 * if (result.isErr()) {
 *   if (result.error.code === 'CONNECTION_NOT_FOUND') {
 *     // Prompt user to connect their Shopify account
 *   }
 * }
 */
export async function getAppConnection(appId: string, organizationId: string, userId: string) {
  // Try user-scoped connection first
  const userConnectionResult = await fromDatabase(
    database.query.WorkflowCredentials.findFirst({
      where: (creds, { eq, and }) =>
        and(
          eq(creds.appId, appId),
          eq(creds.organizationId, organizationId),
          eq(creds.userId, userId),
          eq(creds.type, 'app-connection')
        ),
    }),
    'get-user-connection'
  )

  if (userConnectionResult.isErr()) {
    return userConnectionResult
  }

  const userConnection = userConnectionResult.value

  if (userConnection) {
    const credentialData = await CredentialService.loadCredential(userConnection.id, organizationId)
    return ok(credentialData)
  }

  // Fall back to organization-scoped connection
  const organizationConnectionResult = await fromDatabase(
    database.query.WorkflowCredentials.findFirst({
      where: (creds, { eq, and, isNull }) =>
        and(
          eq(creds.appId, appId),
          eq(creds.organizationId, organizationId),
          isNull(creds.userId), // Organization connection has no userId
          eq(creds.type, 'app-connection')
        ),
    }),
    'get-org-connection'
  )

  if (organizationConnectionResult.isErr()) {
    return organizationConnectionResult
  }

  const organizationConnection = organizationConnectionResult.value

  if (organizationConnection) {
    const credentialData = await CredentialService.loadCredential(
      organizationConnection.id,
      organizationId
    )
    return ok(credentialData)
  }

  return err({
    code: 'CONNECTION_NOT_FOUND',
    message: 'Connection not found',
    appId,
    organizationId,
    userId,
  })
}
