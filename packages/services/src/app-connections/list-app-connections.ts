// packages/services/src/app-connections/list-app-connections.ts

import { CredentialService } from '@auxx/credentials'
import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { AppConnection, DecryptedConnectionData } from './types'

const logger = createScopedLogger('list-app-connections')

/**
 * List active connections for an organization
 *
 * Retrieves all app connections for an organization, with optional filtering by user.
 * This function is used to display connection status in the UI and allows users to
 * manage their app connections.
 *
 * The function returns a list of connections with metadata including:
 * - Connection status (connected, not_connected, expired)
 * - Who created the connection
 * - When it was created
 * - Whether it's organization-scoped or user-scoped
 *
 * Both organization-scoped (global) and user-scoped connections can coexist:
 * - Organization connections: Shared across all users, no userId field
 * - User connections: Specific to individual users, has userId field
 *
 * This function uses Drizzle's relational query API to efficiently join with
 * the App and User tables to fetch display names.
 *
 * @param {string} organizationId - The unique identifier of the organization.
 * @param {string} [userId] - Optional user ID to filter connections.
 *                            If provided, only returns connections created by this user.
 *                            If omitted, returns all connections for the organization
 *                            (both user-scoped and org-scoped).
 *
 * @returns {Promise<Result<AppConnection[], Error>>}
 *          A Result containing either:
 *          - Success: Array of AppConnection objects with metadata
 *          - Error: Database error from the query
 *
 * @example
 * // List all connections for an organization
 * const result = await listAppConnections('org-123')
 * if (result.isOk()) {
 *   const connections = result.value
 *   connections.forEach(conn => {
 *     console.log(`${conn.appName}: ${conn.connectionStatus}`)
 *     console.log(`Scope: ${conn.global ? 'Organization' : 'User'}`)
 *   })
 * }
 *
 * @example
 * // List only user-specific connections
 * const result = await listAppConnections('org-123', 'user-456')
 * if (result.isOk()) {
 *   const userConnections = result.value
 *   // Only shows connections created by user-456
 * }
 */
export async function listAppConnections(organizationId: string, userId?: string) {
  const credentialsResult = await fromDatabase(
    database.query.WorkflowCredentials.findMany({
      where: (creds, { eq, and, isNotNull }) => {
        const conditions = [
          eq(creds.organizationId, organizationId),
          eq(creds.type, 'app-connection'),
          isNotNull(creds.appId),
        ]

        // If userId provided, filter to user-specific connections
        if (userId) {
          conditions.push(eq(creds.userId, userId))
        }

        return and(...conditions)
      },
      with: {
        app: {
          columns: {
            title: true,
          },
        },
        createdBy: {
          columns: {
            name: true,
          },
        },
      },
    }),
    'list-app-connections'
  )

  if (credentialsResult.isErr()) {
    return credentialsResult
  }

  const credentials = credentialsResult.value

  const connections: AppConnection[] = credentials.map((cred) => {
    // Determine status by checking expiration
    let status: 'connected' | 'not_connected' | 'expired' = 'connected'
    let expiresAt: Date | undefined

    // Check if OAuth2 token is expired
    try {
      const decryptedData = CredentialService.decrypt(cred.encryptedData) as DecryptedConnectionData

      if (decryptedData.expiresAt) {
        expiresAt = new Date(decryptedData.expiresAt)
        const now = new Date()

        if (expiresAt < now) {
          status = 'expired'
        }
      }
    } catch (error) {
      // If decryption fails, log but keep as connected (default status)
      // We don't want to falsely mark new connections as expired
      logger.warn('Failed to decrypt credential for status check', {
        credentialId: cred.id,
        error: error instanceof Error ? error.message : String(error),
      })
      // status remains 'connected' - only mark expired if we can verify the expiration date
    }

    return {
      id: cred.id,
      appId: cred.appId!,
      appInstallationId: cred.appInstallationId,
      appName: cred.app?.title || 'Unknown App',
      label: cred.label,
      connectionStatus: status,
      connectedBy: cred.createdBy?.name || undefined,
      connectedAt: cred.createdAt,
      expiresAt,
      global: !cred.userId, // If no userId, it's organization-scoped
    }
  })

  return ok(connections)
}
