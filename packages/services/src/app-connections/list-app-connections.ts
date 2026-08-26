// packages/services/src/app-connections/list-app-connections.ts

import { listCredentials } from '@auxx/credentials/store'
import { database, schema } from '@auxx/database'
import { inArray } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { AppConnection } from './types'

/**
 * Number of consecutive failures at which the refresh circuit breaker is
 * considered "open" — mirrors the OAuth2 token-refresh path (a permanent
 * failure jumps straight to this value). A connection at or above this count is
 * surfaced as `expired` below. Also stamped by `markAppConnectionExpired`
 * (now in `@auxx/lib/apps`) when a tool call hits a 401/403.
 */
const CONNECTION_CIRCUIT_OPEN_THRESHOLD = 5

/**
 * Split a stored granted-scope string into individual scopes.
 *
 * RFC 6749 §3.3 specifies space-delimited, but several providers (Shopify among them) use
 * commas, so both are accepted rather than assumed — the same rule as `parseScopeString`
 * in `@auxx/sdk`, reimplemented here because `@auxx/sdk` is not a dependency of this
 * package and the granted scope is not an app-runtime concern.
 *
 * Always returns an array, never null/undefined, so the client never branches on absence.
 */
export function parseGrantedScopes(raw: unknown): string[] {
  return typeof raw === 'string' ? raw.split(/[\s,]+/).filter(Boolean) : []
}

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
  // userId provided → that user's connections; omitted → all (user- and org-scoped).
  const credentialsResult = await listCredentials({
    organizationId,
    kind: 'app',
    withCreatedBy: true,
    ...(userId ? { userId } : {}),
  })

  if (credentialsResult.isErr()) {
    return err(credentialsResult.error)
  }

  const credentials = credentialsResult.value

  // App titles come from the App table (not a credential concern) — one batched lookup.
  const appIds = [...new Set(credentials.map((c) => c.appId).filter((id): id is string => !!id))]
  const titleById = new Map<string, string>()
  if (appIds.length > 0) {
    const appsResult = await fromDatabase(
      database
        .select({ id: schema.App.id, title: schema.App.title })
        .from(schema.App)
        .where(inArray(schema.App.id, appIds)),
      'list-app-connection-titles'
    )
    if (appsResult.isErr()) {
      return err(appsResult.error)
    }
    for (const app of appsResult.value) titleById.set(app.id, app.title)
  }

  const now = new Date()
  const connections: AppConnection[] = credentials.map((cred) => {
    // Circuit-breaker: a connection whose refresh circuit is open — or that was
    // marked failed at tool-execution time via `markAppConnectionExpired` — is
    // surfaced as expired even when the token itself carries no expiry (e.g.
    // Shopify offline tokens, which never expire but can be revoked).
    let status: 'connected' | 'not_connected' | 'expired' =
      cred.consecutiveRefreshFailures >= CONNECTION_CIRCUIT_OPEN_THRESHOLD ? 'expired' : 'connected'

    // expiresAt is now a column — no decrypt needed for the status check.
    const expiresAt = cred.expiresAt ?? undefined
    if (expiresAt && expiresAt < now) {
      status = 'expired'
    }

    return {
      id: cred.id,
      appId: cred.appId!,
      appInstallationId: cred.appInstallationId,
      appName: (cred.appId && titleById.get(cred.appId)) || 'Unknown App',
      label: cred.label,
      connectionStatus: status,
      // Why it went `expired`. Without this the list can say a connection is broken but not what
      // broke it — the state that let a dead Shopify credential sit unnoticed for 8 days.
      lastRefreshError: cred.lastRefreshError ?? undefined,
      lastRefreshFailureAt: cred.lastRefreshFailureAt ?? undefined,
      connectedBy: cred.createdByName || undefined,
      connectedAt: cred.createdAt,
      expiresAt,
      global: !cred.userId, // If no userId, it's organization-scoped
      userId: cred.userId,
      connectionDefinitionId: cred.connectionDefinitionId,
      isDefault: cred.isDefault, // primary org connection used by record actions (§4a)
      // Plain variables only — secret-flagged values live in encryptedSecrets and never list.
      connectionVariables: (cred.metadata?.connectionVariables ?? undefined) as
        | Record<string, string>
        | undefined,
      // What the provider actually GRANTED (stamped by `resolveGrantedScopes` at every
      // callback). Reconnect re-requests this ∩ the definition's optional list so a full
      // re-auth cannot silently downgrade a connection that holds an optional scope —
      // plans/connections/optional-oauth-scopes.md §4.4/§4.6.
      grantedScopes: parseGrantedScopes(cred.metadata?.scope),
    }
  })

  return ok(connections)
}
