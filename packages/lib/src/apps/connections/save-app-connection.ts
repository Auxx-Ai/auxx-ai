// packages/lib/src/apps/connections/save-app-connection.ts

import { BYO_CLIENT_KEYS } from '@auxx/credentials/connections'
import {
  getCredential,
  insertCredential,
  listCredentials,
  recordRefreshSuccess,
  rotateSecrets,
  updateCredential,
} from '@auxx/credentials/store'
import { database } from '@auxx/database'
import {
  logger,
  mergeConnectionVariables,
  renameAppConnection,
  safeSerializeMetadata,
} from '@auxx/services/app-connections'
import { err, ok } from 'neverthrow'
import { mergeManualConnectionEdit } from '../../connections/merge-manual-edit'
import { ConflictError } from '../../errors'
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
 * Persists an app connection with encrypted credentials. There are three distinct paths:
 *
 * 1. **Explicit reconnect** (`options.connectionId` given) — rotates the tokens/secrets of that
 *    specific credential and resets its refresh circuit breaker. No new row, no
 *    `connection-added` event. Guarded: if the app declares a `connection-identify` handler
 *    and the account behind the new token is not the one stored on the row, the reconnect is
 *    REFUSED rather than silently repointing every connection-scoped mapping at a different
 *    account (see the branch's own comment, and task 24 §3).
 * 2. **Identity dedup** (fresh connect, app declares a `connection-identify` handler) — the
 *    handler returns a stable provider identity (realm id, workspace id, account email). If an
 *    existing connection in the same visibility scope already carries that identity
 *    (`metadata.__identity`), it is updated in place (same as an explicit reconnect) instead of
 *    creating a duplicate. Returns `matchedExisting: true` so callers can toast.
 * 3. **Fresh insert** (fresh connect, no identity match or no handler) — inserts a new
 *    credential and fires the `connection-added` app event so the app can run its setup
 *    (register webhooks, resolve a `{ label }`, etc.).
 *
 * The function handles two credential shapes:
 * - OAuth2 flow completion: access_token, refresh_token, and expiry from an OAuth callback
 * - Manual secret entry: API keys or secrets entered directly by the user
 *
 * Secret credential data is encrypted via the credential store (insertCredential/rotateSecrets)
 * before being stored; non-secret data (including the reserved `metadata.__identity` dedup key)
 * goes in plaintext `metadata`.
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
 * @returns {Promise<Result<{ credentialId: string; matchedExisting: boolean }, Error>>}
 *          A Result containing either:
 *          - Success: `{ credentialId, matchedExisting }` — the credential ID of the
 *            created/updated connection, and whether it matched an existing connection by
 *            provider identity (`true`) rather than being freshly inserted (`false`). An
 *            explicit reconnect returns `matchedExisting: false` (it is not a silent dedup).
 *          - Error: Database error, CONNECTION_CREATE_FAILED if creation fails, or a
 *            `ConflictError` when an explicit reconnect authorized a different provider
 *            account than the one the connection is linked to (nothing is written).
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
/**
 * Connection variables an app's own event handlers are allowed to see.
 *
 * A bring-your-own OAuth client id/secret is platform-level auth config, not a connector
 * input — no `connection-identify` or `connection-added` handler has any use for it, and for
 * a marketplace app those handlers are third-party code. Strip them before they cross that
 * boundary. See plans/connections/byo-oauth-client-runtime-gap.md §3 F3.
 */
function appVisibleFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!BYO_CLIENT_KEYS.has(key)) out[key] = value
  }
  return out
}

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

    // 🛑 A reconnect keeps the credential ID, so it must not be allowed to repoint the row
    // at a DIFFERENT provider account. Connection-scoped `CustomField` rows are keyed on
    // this id, and every value under them is a correspondence between one of our records
    // and one of THAT account's ids. Swap the account underneath and nothing is deleted or
    // flagged - the whole map is silently reinterpreted against a stranger. On QuickBooks
    // that is 96 stored account ids read against a different company; ids there are
    // per-company sequences, so the entry still balances and posts to the wrong accounts.
    //
    // So ask the app who it just connected to, before anything is written. The machinery is
    // the same generic `connection-identify` handler the fresh-connect path below uses to
    // dedupe - no provider knowledge here, and the guard covers Shopify stores and Stripe
    // accounts on the same terms.
    // See plans/accounting/tasks/24-the-company-on-the-entry.md §3.
    const identifier = await resolveConnectionIdentity(appInstallationId, connectionData, metadata)
    if (identifier) {
      const existingResult = await getCredential(options.connectionId, organizationId)
      const storedIdentity = existingResult.isOk()
        ? String(
            (existingResult.value.metadata as Record<string, unknown> | null | undefined)
              ?.__identity ?? ''
          ).trim()
        : ''
      // What to CALL the connected account in the refusal. The label is the app's own
      // name for it - the QuickBooks `connection-added` handler writes the company name,
      // Shopify writes the store domain - and it is what the row already reads as on the
      // connections list. The raw identity is a realm id or a numeric account id: fine in
      // a log, not a thing to put in front of a person. Falls back to it only when an app
      // left the label empty.
      const storedLabel =
        (existingResult.isOk() ? existingResult.value.label?.trim() : '') || storedIdentity

      if (storedIdentity && storedIdentity !== identifier) {
        // Refuse rather than cascade. A menu item called "Reconnect" is not a place a
        // person can be expected to anticipate losing the mapping, and there is no confirm
        // on this path. The correct migration is already visible: Disconnect, then Add
        // Connection - every mapped row reads "not linked" and refuses until re-linked,
        // which is a state somebody can act on. A refusal can also name both accounts;
        // a cascade cannot explain itself afterwards (§3.2).
        logger.warn('Refusing reconnect - the authorized account is not the connected one', {
          credentialId: options.connectionId,
          appInstallationId,
          storedIdentity,
          identifier,
        })
        // ⚠️ Names the connected account and NOT the one just authorized. We hold no
        // label for the new account (identify returns a bare identifier), and printing a
        // raw realm id at somebody tells them nothing they can act on. Both ids are in
        // the warn above for whoever is actually debugging.
        return err(
          new ConflictError(
            `This connection is linked to ${storedLabel}, and you just authorized a ` +
              `different account. Reconnecting cannot move a connection to another ` +
              `account - everything mapped through it is keyed to the original. ` +
              `Disconnect this connection first, then add the new one.`
          )
        )
      }

      // ⚠️ Re-stamp the identity onto the metadata this reconnect is about to persist.
      // A reconnect is an OAuth mint, so `updateExistingConnection` takes the rotate branch
      // and `updateCredential(…, { metadata })` REPLACES metadata wholesale with what the
      // callback built. Without this line `__identity` is not merely stale, it is deleted -
      // and a later fresh connect to the SAME account then matches nothing and mints a
      // duplicate row (§3.3). Mutating `metadata` and relinking it to `connectionData` is
      // the same handoff the fresh-connect path uses below.
      metadata.__identity = identifier
      connectionData.metadata = metadata
    }

    const updated = await updateExistingConnection(
      options.connectionId,
      organizationId,
      connectionData
    )
    if (updated.isErr()) {
      return err(updated.error)
    }

    // No app-field provisioning here — connector sync setup runs the authoritative
    // reconcile (create/drift/orphan) and parks visibly on any error, so a field the
    // catalog gained since this connection was created self-heals on the next sync.
    logger.info('Successfully reconnected app connection:', { credentialId: options.connectionId })
    // An explicit reconnect is not a silent identity dedup — matchedExisting is false.
    return ok({ credentialId: options.connectionId, matchedExisting: false })
  }

  // Create new connection with auto-generated label
  logger.info('Creating new app connection')

  // Identity dedup (fresh connect): if this app declares a `connection-identify` handler,
  // ask it for the freshly minted connection's stable provider identity BEFORE inserting.
  // A pre-insert match updates the existing row in place instead of minting a duplicate —
  // no new row, no `connection-added` re-fire (setup already ran for that account).
  const identifier = await resolveConnectionIdentity(appInstallationId, connectionData, metadata)

  // Empty identifier → no handler, a failed handler, or an app opting out → plain insert.
  if (identifier) {
    // Persist the identity on plaintext metadata so future connects (and this insert)
    // can match it. Mutating `metadata` here also updates `connectionData.metadata`
    // when the caller supplied one; otherwise link them so the update path below (which
    // recomputes metadata from connectionData) persists `__identity` too.
    metadata.__identity = identifier
    connectionData.metadata = metadata

    // Same visibility scope as dedupeLabel — (appId, appInstallationId, userId). Org- and
    // user-scoped rows are disjoint, so a personal and a workspace connection with the same
    // identity stay two distinct rows.
    const existing = await listCredentials({
      organizationId,
      kind: 'app',
      appId,
      appInstallationId,
      userId,
    })
    const match = existing.isOk()
      ? existing.value.find((row) => row.metadata?.__identity === identifier)
      : undefined

    if (match) {
      const updated = await updateExistingConnection(match.id, organizationId, connectionData)
      if (updated.isErr()) {
        return err(updated.error)
      }
      logger.info('Matched existing connection by identity — updated in place', {
        credentialId: match.id,
        appInstallationId,
      })
      // Keep the matched row's isDefault flag; no new row, no connection-added.
      return ok({ credentialId: match.id, matchedExisting: true })
    }
  }

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
  const fields = appVisibleFields(
    mergeConnectionVariables(metadata, { fields: connectionData.secretFields })
  )

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

  return ok({ credentialId: created.id, matchedExisting: false })
}

/**
 * Update an existing connection's stored credentials in place — used by both the explicit
 * reconnect path (`options.connectionId`) and the identity-dedup match path. Rotates the
 * tokens/secrets and resets the refresh circuit breaker. Deliberately does NOT fire a
 * `connection-added` event: the account's setup (webhooks, label) already exists.
 */
async function updateExistingConnection(
  connectionId: string,
  organizationId: string,
  connectionData: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
    secret?: string
    secretFields?: Record<string, string>
    metadata?: Record<string, any>
  }
) {
  const secrets = pickSecrets(connectionData)
  const metadata = (connectionData.metadata ?? {}) as Record<string, unknown>
  const expiresAt = connectionData.expiresAt ? new Date(connectionData.expiresAt) : null

  // OAuth mint (the callback route) carries fresh tokens and legitimately replaces everything;
  // a manual secret edit carries only secretFields/secret + plain vars and must MERGE so editing
  // one field never wipes the stored secret or drops a plain var the user didn't re-supply.
  const isOAuthMint =
    connectionData.accessToken !== undefined || connectionData.refreshToken !== undefined

  if (isOAuthMint) {
    const rotated = await rotateSecrets(connectionId, organizationId, secrets, { expiresAt })
    if (rotated.isErr()) {
      return err(rotated.error)
    }

    // Refresh the plaintext companion metadata alongside the rotated secrets.
    const metaUpdated = await updateCredential(connectionId, organizationId, { metadata })
    if (metaUpdated.isErr()) {
      return err(metaUpdated.error)
    }
  } else {
    const reconnected = await mergeManualConnectionEdit(connectionId, organizationId, {
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
  const breakerReset = await recordRefreshSuccess(connectionId, organizationId, { expiresAt })
  if (breakerReset.isErr()) {
    return err(breakerReset.error)
  }

  return ok(undefined)
}

/**
 * Ask the app which provider account a freshly minted token belongs to.
 *
 * Returns the app's stable identifier for that account (a QuickBooks realm, a Shopify shop
 * domain, a workspace id), or `''` when there is no usable answer. Both callers treat `''`
 * the same way — carry on — so the four "no answer" cases collapse into one return value:
 * the app declares no `connection-identify` handler, the handler failed, the handler threw,
 * or the handler deliberately returned nothing to opt out of dedup for this connect.
 *
 * ⚠️ That tolerance is the accepted hole in the reconnect guard above, and it is deliberate.
 * Refusing on a handler failure would break every reconnect while an app's Lambda is down -
 * and reconnect is *the repair path for an expired token*. Blocking repair to catch a rare
 * misconfiguration is the worse trade (§3.5).
 *
 * The declared-events gate reads the active deployment's catalog, the same source
 * `triggerAppEvent` uses, so a missing installation/deployment/catalog means today's
 * behavior rather than an error.
 */
async function resolveConnectionIdentity(
  appInstallationId: string,
  connectionData: {
    accessToken?: string
    secret?: string
    secretFields?: Record<string, string>
    metadata?: Record<string, any>
  },
  metadata: Record<string, unknown>
): Promise<string> {
  try {
    const declaredEvents = await loadDeclaredEvents(appInstallationId)
    if (!declaredEvents.includes('connection-identify')) return ''

    const identifyType: 'oauth2-code' | 'secret' = connectionData.accessToken
      ? 'oauth2-code'
      : 'secret'
    // Token is already in hand — the row may not exist yet, so no `id` is sent to identify.
    const identifyValue = connectionData.accessToken || connectionData.secret || ''
    const identifyFields = appVisibleFields(
      mergeConnectionVariables(metadata, {
        fields: connectionData.secretFields,
      })
    )

    const identifyResult = await triggerAppEvent({
      appInstallationId,
      eventType: 'connection-identify',
      payload: {
        connection: {
          type: identifyType,
          value: identifyValue,
          ...(Object.keys(identifyFields).length > 0 && { fields: identifyFields }),
          metadata: safeSerializeMetadata(connectionData.metadata),
        },
      },
    })

    if (identifyResult.isErr()) {
      logger.error('connection-identify handler failed; proceeding without an identity', {
        appInstallationId,
        error: identifyResult.error.message,
      })
      return ''
    }

    const handlerResult = identifyResult.value.result
    return handlerResult && typeof handlerResult === 'object' && 'identifier' in handlerResult
      ? String((handlerResult as { identifier?: unknown }).identifier ?? '').trim()
      : ''
  } catch (error) {
    logger.error('connection-identify threw; proceeding without an identity', {
      appInstallationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

/**
 * Ids of app-side event handlers the installation's active deployment declares (e.g.
 * `connection-identify`). Read from the deployment catalog — the same source
 * `triggerAppEvent` uses. A missing installation / deployment / catalog / list yields `[]`,
 * so the caller falls back to today's behavior (no identify hook).
 */
async function loadDeclaredEvents(appInstallationId: string): Promise<string[]> {
  try {
    const installation = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, appInstallationId),
      with: {
        currentDeployment: { columns: { catalog: true } },
      },
    })
    return installation?.currentDeployment?.catalog?.events ?? []
  } catch (error) {
    logger.error('Failed to load declared events for connection-identify gate', {
      appInstallationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
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
