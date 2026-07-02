// packages/lib/src/apps/connections/save-app-connection.ts

import {
  insertCredential,
  listCredentials,
  recordRefreshSuccess,
  rotateSecrets,
  updateCredential,
} from '@auxx/credentials/store'
import {
  logger,
  mergeConnectionVariables,
  renameAppConnection,
  safeSerializeMetadata,
} from '@auxx/services/app-connections'
import { err, ok } from 'neverthrow'
import { mergeManualConnectionEdit } from '../../connections/merge-manual-edit'
import { triggerAppEvent } from '../events'
import { reconcileInstallationAppFields } from '../installations/app-field-provisioning'
import { resolveActiveInstallationId } from '../installations/resolve-active-installation'

/**
 * Pick the secret keys (present only) out of an app-connection's credential data.
 * Secret-flagged connection variables nest under `fields` so user-defined keys can
 * never collide with the reserved `accessToken`/`refreshToken`/`secret` keys.
 */
function pickSecrets(data: {
  accessToken?: string
  refreshToken?: string
  secret?: string
  secretFields?: Record<string, string>
}): Record<string, unknown> {
  const secrets: Record<string, unknown> = {}
  if (data.accessToken !== undefined) secrets.accessToken = data.accessToken
  if (data.refreshToken !== undefined) secrets.refreshToken = data.refreshToken
  if (data.secret !== undefined) secrets.secret = data.secret
  if (data.secretFields !== undefined) secrets.fields = data.secretFields
  return secrets
}

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
 * Secret credential data is encrypted via the credential store (insertCredential/rotateSecrets)
 * before being stored; non-secret data goes in plaintext `metadata`. The function also triggers
 * a 'connection-added' app event
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
 * @param {Record<string, string>} [connectionData.secretFields] - Secret-flagged connection
 *                                                                 variables, encrypted under
 *                                                                 `secrets.fields`. Plain variables
 *                                                                 ride in `metadata.connectionVariables`.
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
    secretFields?: Record<string, string>
    metadata?: Record<string, any>
  },
  options?: {
    label?: string
    connectionId?: string
    /**
     * The connection method the org chose (ConnectionDefinition.id). Written to the
     * credential FK so the runtime resolver loads the exact method's type/authApply
     * instead of guessing a def by (appId, scope). Required for multi-method apps.
     */
    connectionDefinitionId?: string
  }
) {
  const credentialName = `${appName} Connection`
  const secrets = pickSecrets(connectionData)
  const metadata = (connectionData.metadata ?? {}) as Record<string, unknown>

  // Resolve the current active installation ID server-side to guard against
  // stale frontend caches that may reference a previous (soft-deleted) installation.
  const resolvedResult = await resolveActiveInstallationId(appId, organizationId)
  if (resolvedResult.isErr()) {
    logger.error('Failed to resolve active installation', {
      appId,
      organizationId,
      error: resolvedResult.error.message,
    })
    return err(resolvedResult.error)
  }

  const resolvedInstallationId = resolvedResult.value
  if (resolvedInstallationId !== appInstallationId) {
    logger.warn('Stale appInstallationId detected — using resolved active installation', {
      provided: appInstallationId,
      resolved: resolvedInstallationId,
      appId,
      organizationId,
    })
  }

  // Use the resolved ID for all downstream operations
  appInstallationId = resolvedInstallationId

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

    // OAuth mint (the callback route) carries fresh tokens and legitimately replaces everything;
    // a manual secret edit carries only secretFields/secret + plain vars and must MERGE so editing
    // one field never wipes the stored secret or drops a plain var the user didn't re-supply.
    const isOAuthMint =
      connectionData.accessToken !== undefined || connectionData.refreshToken !== undefined

    if (isOAuthMint) {
      const rotated = await rotateSecrets(options.connectionId, organizationId, secrets, {
        expiresAt,
      })
      if (rotated.isErr()) {
        return err(rotated.error)
      }

      // Refresh the plaintext companion metadata alongside the rotated secrets.
      const metaUpdated = await updateCredential(options.connectionId, organizationId, { metadata })
      if (metaUpdated.isErr()) {
        return err(metaUpdated.error)
      }
    } else {
      const reconnected = await mergeManualConnectionEdit(options.connectionId, organizationId, {
        secretFields: connectionData.secretFields,
        secret: connectionData.secret,
        plainVariables: (metadata.connectionVariables ?? {}) as Record<string, unknown>,
      })
      if (reconnected.isErr()) {
        return err(reconnected.error)
      }
    }

    // A successful re-auth clears any open refresh circuit breaker. Without this the
    // connection keeps surfacing as "expired" (consecutiveRefreshFailures >= threshold)
    // even though it now holds a fresh token — recordRefreshSuccess resets the breaker
    // and stamps lastRefreshAt alongside the already-rotated expiry.
    const breakerReset = await recordRefreshSuccess(options.connectionId, organizationId, {
      expiresAt,
    })
    if (breakerReset.isErr()) {
      return err(breakerReset.error)
    }

    // No app-field provisioning here — connector sync setup runs the authoritative
    // reconcile (create/drift/orphan) and parks visibly on any error, so a field the
    // catalog gained since this connection was created self-heals on the next sync.
    logger.info('Successfully reconnected app connection:', { credentialId: options.connectionId })
    return ok(options.connectionId)
  }

  // Create new connection with auto-generated label
  logger.info('Creating new app connection')

  // Generate the initial label. Defaults to the app name, deduped within this
  // connection's own visibility scope (see dedupeLabel). An app's
  // connection-added handler may replace it with something meaningful below.
  const label =
    options?.label ||
    (await dedupeLabel(appName, { organizationId, appId, appInstallationId, userId }))

  // expiresAt lives only as a column (the secrets blob holds secrets only).
  const expiresAt = connectionData.expiresAt ? new Date(connectionData.expiresAt) : null

  // First org-scoped connection for an app becomes the primary that record actions
  // (and other unbound, org-global resolvers) use. Agents/workflows bind a credId and
  // ignore this. Only org-scoped rows (userId === null) are eligible — record actions
  // resolve org-scope only. Re-primaries the app if a prior primary was deleted.
  let isDefault = false
  if (userId === null) {
    const existing = await listCredentials({ organizationId, kind: 'app', appId, userId: null })
    isDefault = !(existing.isOk() && existing.value.some((c) => c.isDefault))
  }

  const createResult = await insertCredential({
    organizationId,
    createdById,
    kind: 'app',
    userId,
    appId,
    appInstallationId,
    connectionDefinitionId: options?.connectionDefinitionId ?? null,
    isDefault,
    name: credentialName,
    label,
    secrets,
    metadata,
    expiresAt,
  })

  if (createResult.isErr()) {
    return err(createResult.error)
  }

  const created = createResult.value

  logger.info('Successfully created app connection:', { credentialId: created.id })

  // Provision this app's connection-scoped custom fields for the new account
  // (app-registered custom fields §5, decisions 7–8). Only org-scoped
  // connections (userId === null) qualify — a visitor's identity must be one
  // truth for the org, not vary by teammate. Best-effort: a provisioning
  // failure is logged but does not fail the connection save (same posture as
  // the connection-added event below). Connection-scoped field rows are removed
  // automatically when the connection is deleted (CustomField.connectionId FK
  // is ON DELETE CASCADE).
  if (userId === null) {
    try {
      // Reconcile the whole installation against the catalog now that a new
      // org-scoped connection exists — creates this connection's connection-scoped
      // fields (and heals any drift), busting the customFields org cache when
      // anything changed. The authoritative reconcile still runs at sync setup;
      // this warm-up just makes the fields resolvable before the first sync.
      await reconcileInstallationAppFields({ appInstallationId, organizationId })
    } catch (error) {
      logger.error('Failed to reconcile app fields for new connection', {
        error: error instanceof Error ? error.message : String(error),
        credentialId: created.id,
        appInstallationId,
      })
    }
  }

  // Trigger connection-added event
  // Determine connection type based on what data we have
  const connectionType: 'oauth2-code' | 'secret' = connectionData.accessToken
    ? 'oauth2-code'
    : 'secret'
  const connectionValue = connectionData.accessToken || connectionData.secret || ''
  // Merged connection variables (plain + secret-flagged) — apps validate credentials
  // in their connection-added handler (e.g. mint a token, return `{ label }`).
  const fields = mergeConnectionVariables(metadata, { fields: connectionData.secretFields })

  const eventResult = await triggerAppEvent({
    appInstallationId,
    eventType: 'connection-added',
    payload: {
      connection: {
        id: created.id,
        type: connectionType,
        value: connectionValue,
        ...(Object.keys(fields).length > 0 && { fields }),
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

    // An app's connection-added handler may return `{ label }` to name the
    // connection meaningfully — the shop domain, the authenticated email, the
    // workspace name. An explicit caller-provided label (options.label) wins.
    // Best-effort: a missing/failed handler or rename leaves the autoincrement
    // label intact and never fails the connection save.
    if (!options?.label) {
      const handlerResult = eventResult.value.result
      const handlerLabel =
        handlerResult && typeof handlerResult === 'object' && 'label' in handlerResult
          ? String((handlerResult as { label?: unknown }).label ?? '').trim()
          : ''

      if (handlerLabel) {
        const deduped = await dedupeLabel(
          handlerLabel,
          { organizationId, appId, appInstallationId, userId },
          created.id
        )
        const renamed = await renameAppConnection(created.id, deduped, organizationId)
        if (renamed.isErr()) {
          logger.error('Failed to apply handler connection label', {
            credentialId: created.id,
            error: renamed.error,
          })
        }
      }
    }
  }

  return ok(created.id)
}

/**
 * Make a desired connection label unique within its visibility scope by
 * appending the lowest free `(n)` suffix: "Gmail", "Gmail (2)", "Gmail (3)".
 *
 * Scope is matched to how the connections UI renders rows — Personal rows are
 * filtered to a single user, Workspace rows are org-wide — so dedup counts only
 * rows the same viewer would see:
 *  - `userId === null`  → workspace scope (other org-wide rows)
 *  - `userId === <id>`  → that user's personal rows
 *
 * `excludeId` skips a just-inserted row when re-deriving its own label.
 */
async function dedupeLabel(
  desired: string,
  scope: {
    organizationId: string
    appId: string
    appInstallationId: string
    userId: string | null
  },
  excludeId?: string
): Promise<string> {
  const existingResult = await listCredentials({
    organizationId: scope.organizationId,
    kind: 'app',
    appId: scope.appId,
    appInstallationId: scope.appInstallationId,
    userId: scope.userId, // null → org-scoped rows; a string → that user
  })

  const taken = new Set(
    (existingResult.isOk() ? existingResult.value : [])
      .filter((row) => row.id !== excludeId)
      .map((row) => row.label)
      .filter((l): l is string => !!l)
  )

  if (!taken.has(desired)) return desired
  let n = 2
  while (taken.has(`${desired} (${n})`)) n++
  return `${desired} (${n})`
}
