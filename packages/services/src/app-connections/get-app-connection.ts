// packages/services/src/app-connections/get-app-connection.ts

import { findCredential, revealSecrets } from '@auxx/credentials/store'
import { err, ok } from 'neverthrow'
import type { DecryptedConnectionData } from './types'

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
 * The function uses the credential store's revealSecrets to decrypt the stored credentials,
 * ensuring sensitive data like OAuth tokens and API secrets are never returned in encrypted form.
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
  // Try user-scoped connection first, then fall back to the org-scoped one. Newest wins —
  // duplicates can accumulate (e.g. an OAuth provider that issues a fresh token per
  // (re)connect), and an older row's token is typically revoked once a newer one is issued.
  const userResult = await findCredential({ organizationId, kind: 'app', appId, userId })
  if (userResult.isErr()) return err(userResult.error)

  let record = userResult.value
  if (!record) {
    const orgResult = await findCredential({ organizationId, kind: 'app', appId, userId: null })
    if (orgResult.isErr()) return err(orgResult.error)
    record = orgResult.value
  }

  if (!record) {
    return err({
      code: 'CONNECTION_NOT_FOUND',
      message: 'Connection not found',
      appId,
      organizationId,
      userId,
    })
  }

  const revealed = await revealSecrets(record.id, organizationId)
  if (revealed.isErr()) return err(revealed.error)

  // Preserve the legacy "full data" shape: non-secret companion fields flattened to the top
  // level, secrets layered on top (secrets win on key collisions). Spreading two
  // index-signature types erases every named key, so the shape is asserted once here
  // rather than at each call site.
  return ok({
    ...revealed.value.record.metadata,
    ...revealed.value.secrets,
  } as DecryptedConnectionData)
}
