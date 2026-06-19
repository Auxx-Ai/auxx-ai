// packages/lib/src/connections/resolve-connection-for-runtime.ts
// The one runtime resolver for every connection owner — app, mcp server, or
// platform built-in provider. Collapses resolve-app/resolve-mcp: find the
// ConnectionDefinition, find the Credential, reveal, and lazily refresh oauth2
// tokens. Because it resolves by connectionType (not `kind`), workflow/platform
// credentials get auto-refresh-on-use for free.

import { findCredential, revealSecrets } from '@auxx/credentials/store'
import { type AuthApply, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  type DecryptedConnectionData,
  mergeConnectionVariables,
} from '@auxx/services/app-connections'
import { interpolateTemplate } from '@auxx/utils'
import { err, ok, type Result } from 'neverthrow'
import { ensureFreshCredentialToken } from '../credentials/ensure-fresh-credential-token'
import { defaultAuthApply } from './auth-apply'

const logger = createScopedLogger('resolve-connection-for-runtime')

/** Secrets no longer carry expiry/metadata — those come from the record columns. */
type ConnectionSecrets = Pick<
  DecryptedConnectionData,
  'accessToken' | 'refreshToken' | 'secret' | 'fields'
>

/**
 * Connection data passed to a runtime executor — the decrypted credential value plus the
 * non-secret metadata/expiry consumers need. `value` is the access token (oauth2-code) or API
 * secret (secret); `fields` is the merged connection-variable map (plain + secret-flagged).
 */
export interface RuntimeConnectionData {
  id: string
  type: 'oauth2-code' | 'secret'
  value: string
  fields?: Record<string, string>
  /** Declarative spec for putting this connection on an outgoing HTTP request (§3); null for DB/email/none. */
  authApply?: AuthApply | null
  /** Request origin the connection contributes (§3), interpolated from value + fields
   *  (e.g. 'https://acme.myshopify.com'). The HTTP transport prepends it to a relative
   *  request path. Undefined when the definition declares no `baseUrlTemplate`. */
  baseUrl?: string
  metadata?: any
  expiresAt?: string
}

/** The definition fields that shape the runtime request (auth + endpoint origin). */
interface DefinitionRuntime {
  authApply?: AuthApply | null
  baseUrlTemplate?: string | null
}

export interface ResolveConnectionError {
  code: 'CONNECTION_NOT_FOUND' | 'DATABASE_ERROR' | 'DECRYPTION_ERROR'
  message: string
}

interface RevealedConnection {
  record: {
    id: string
    userId?: string | null
    kind: string
    type?: string | null
    appId?: string | null
    mcpServerId?: string | null
    connectionDefinitionId?: string | null
    metadata: any
    expiresAt?: Date | null
    lastRefreshAt?: Date | null
    createdAt?: Date
  }
  secrets: ConnectionSecrets
}

function secretValue(secrets: ConnectionSecrets): string {
  return secrets.accessToken || secrets.secret || ''
}

function connectionFields(
  record: { metadata: any },
  secrets: ConnectionSecrets
): Record<string, string> | undefined {
  const fields = mergeConnectionVariables(record.metadata, secrets)
  return Object.keys(fields).length > 0 ? fields : undefined
}

/**
 * Lazy refresh: for an `oauth2-code` connection with a stored refresh token, refresh the access
 * token if it is at/near expiry (single-flight, never throws) and re-reveal the rotated secrets.
 * The hot path (fresh token, or `secret`-type, or `ensureFresh: false`) stays at one reveal.
 */
async function refreshIfNeeded(
  revealed: RevealedConnection,
  organizationId: string,
  connectionType: 'oauth2-code' | 'secret',
  ensureFresh: boolean
): Promise<RevealedConnection> {
  const { record, secrets } = revealed
  if (!ensureFresh || connectionType !== 'oauth2-code' || !secrets.refreshToken) {
    return revealed
  }

  const changed = await ensureFreshCredentialToken({
    credentialId: record.id,
    organizationId,
    expiresAt: record.expiresAt,
    lastRefreshAt: record.lastRefreshAt,
    createdAt: record.createdAt,
    hasRefreshToken: true,
  })
  if (!changed) return revealed

  const refreshed = await revealSecrets<ConnectionSecrets>(record.id, organizationId)
  return refreshed.isOk() ? refreshed.value : revealed
}

/** Refresh (if needed) + shape an already-revealed connection into RuntimeConnectionData. */
async function shapeFromRevealed(
  revealed: RevealedConnection,
  organizationId: string,
  connectionType: 'oauth2-code' | 'secret',
  ensureFresh: boolean,
  def: DefinitionRuntime = {}
): Promise<RuntimeConnectionData> {
  const { record, secrets } = await refreshIfNeeded(
    revealed,
    organizationId,
    connectionType,
    ensureFresh
  )
  const value = secretValue(secrets)
  const fields = connectionFields(record, secrets)
  // Interpolate the connection's base-URL template (e.g. '{shop}' / '{value}') from
  // the resolved token + fields — no URL-encoding (a value may itself be a URL or a
  // path-safe token). The transport prepends the result to a relative path.
  const baseUrl = def.baseUrlTemplate
    ? interpolateTemplate(def.baseUrlTemplate, { ...(fields ?? {}), value })
    : undefined
  return {
    id: record.id,
    type: connectionType,
    value,
    fields,
    // Fall back to the connection type's default application (oauth2-code →
    // Bearer) when the definition declares none — app-authored oauth2 defs often
    // omit `authApply`, but an access token is always a bearer token.
    authApply: def.authApply ?? defaultAuthApply(connectionType),
    baseUrl,
    metadata: record.metadata,
    expiresAt: record.expiresAt?.toISOString(),
  }
}

/** Reveal + refresh + shape a single credential into RuntimeConnectionData. */
async function toRuntimeConnection(
  credentialId: string,
  organizationId: string,
  connectionType: 'oauth2-code' | 'secret',
  ensureFresh: boolean,
  def: DefinitionRuntime = {}
): Promise<Result<RuntimeConnectionData, ResolveConnectionError>> {
  const revealed = await revealSecrets<ConnectionSecrets>(credentialId, organizationId)
  if (revealed.isErr()) {
    if (revealed.error.code === 'CREDENTIAL_NOT_FOUND') {
      return err({ code: 'CONNECTION_NOT_FOUND', message: `Connection ${credentialId} not found` })
    }
    logger.error('Failed to decrypt credential', { credentialId, error: revealed.error })
    return err({ code: 'DECRYPTION_ERROR', message: 'Failed to decrypt credential' })
  }

  return ok(
    await shapeFromRevealed(revealed.value, organizationId, connectionType, ensureFresh, def)
  )
}

/**
 * Resolve a single app credential (org- or user-scoped) into RuntimeConnectionData,
 * credential-first: `findCredential` is primary-preferring (§4a), so when an app has more
 * than one connection in this scope — by method OR account — the org's chosen primary wins.
 * The method's definition is loaded from the credential's own FK, so `type`/`authApply`
 * always match the connection the org actually made. Returns `ok(undefined)` when the scope
 * has no credential. The `appId` fallback is defensive for legacy rows whose FK predates
 * §4 (pre-launch reseed writes the FK, making it dead).
 */
async function resolveAppCredential(
  appId: string,
  organizationId: string,
  scopedUserId: string | null,
  ensureFresh: boolean
): Promise<Result<RuntimeConnectionData | undefined, ResolveConnectionError>> {
  const found = await findCredential({ organizationId, kind: 'app', appId, userId: scopedUserId })
  if (found.isErr()) return err({ code: 'DATABASE_ERROR', message: 'Failed to query credential' })
  if (!found.value) return ok(undefined)
  const cred = found.value

  const def = await database.query.ConnectionDefinition.findFirst({
    where: (d, { eq }) =>
      cred.connectionDefinitionId ? eq(d.id, cred.connectionDefinitionId) : eq(d.appId, appId),
    columns: { connectionType: true, authApply: true, baseUrlTemplate: true },
  })
  const connectionType = (def?.connectionType ?? 'secret') as 'oauth2-code' | 'secret'
  return toRuntimeConnection(cred.id, organizationId, connectionType, ensureFresh, {
    authApply: def?.authApply ?? null,
    baseUrlTemplate: def?.baseUrlTemplate,
  })
}

type OwnerInput =
  | { appId: string; mcpServerId?: never; providerKey?: never; connectionId?: string }
  | { mcpServerId: string; appId?: never; providerKey?: never; connectionId?: string }
  | { providerKey: string; appId?: never; mcpServerId?: never; connectionId?: string }
  | { connectionId: string; appId?: never; mcpServerId?: never; providerKey?: never }

/**
 * Resolve connection(s) for runtime execution against any owner.
 *
 * - `appId`: queries the app's user-scoped (global:false) and org-scoped (global:true)
 *   definitions and returns whichever credentials exist.
 * - `mcpServerId`: org-scoped only.
 * - `providerKey`: the single platform-provider definition; its `global` flag decides
 *   whether the credential is org-wide or per-user.
 * - `connectionId`: bind a specific Credential directly (skips definition discovery).
 */
export async function resolveConnectionForRuntime(
  input: OwnerInput & {
    organizationId: string
    userId: string
    /** Skip the lazy OAuth refresh (default `true`). */
    ensureFresh?: boolean
  }
): Promise<
  Result<
    { userConnection?: RuntimeConnectionData; organizationConnection?: RuntimeConnectionData },
    ResolveConnectionError
  >
> {
  const { appId, mcpServerId, providerKey, connectionId, organizationId, userId } = input
  const ensureFresh = input.ensureFresh ?? true

  // Direct credential binding — resolve that row, classify scope by its userId.
  // The definition is found from the credential's own link (FK / owner / providerKey),
  // so a caller (e.g. the HTTP node) can bind by connectionId alone, no owner needed.
  if (connectionId) {
    const revealed = await revealSecrets<ConnectionSecrets>(connectionId, organizationId)
    if (revealed.isErr()) {
      return err({ code: 'CONNECTION_NOT_FOUND', message: `Connection ${connectionId} not found` })
    }
    const { record } = revealed.value
    const defId = record.connectionDefinitionId
    const ownerAppId = appId ?? record.appId
    const ownerMcpServerId = mcpServerId ?? record.mcpServerId
    const ownerProviderKey = providerKey ?? record.type
    // FK-honoring: when the credential names its own definition (`defId`), that row
    // is authoritative — match it alone. The owner arms (which also match the app's
    // *sibling* methods) are only a fallback for legacy rows whose FK predates §4,
    // where `findFirst` over the `or` could otherwise return the wrong method's
    // connectionType / authApply.
    const def = await database.query.ConnectionDefinition.findFirst({
      where: (d, { eq, or }) =>
        defId
          ? eq(d.id, defId)
          : or(
              ownerAppId ? eq(d.appId, ownerAppId) : undefined,
              ownerMcpServerId ? eq(d.mcpServerId, ownerMcpServerId) : undefined,
              ownerProviderKey ? eq(d.providerKey, ownerProviderKey) : undefined
            ),
      columns: { connectionType: true, authApply: true, baseUrlTemplate: true },
    })
    const connectionType = (def?.connectionType ??
      (revealed.value.secrets.accessToken ? 'oauth2-code' : 'secret')) as 'oauth2-code' | 'secret'
    const resolved = await shapeFromRevealed(
      revealed.value,
      organizationId,
      connectionType,
      ensureFresh,
      { authApply: def?.authApply ?? null, baseUrlTemplate: def?.baseUrlTemplate }
    )
    return ok(
      revealed.value.record.userId
        ? { userConnection: resolved }
        : { organizationConnection: resolved }
    )
  }

  // App owner: resolve the user-scoped and org-scoped credentials directly (credential-first).
  // The credential's FK names the exact method, and the org-scoped lookup prefers the primary
  // when an app has >1 connection (method or account) — see resolveAppCredential / §4a.
  if (appId) {
    const userResolved = await resolveAppCredential(appId, organizationId, userId, ensureFresh)
    if (userResolved.isErr()) return err(userResolved.error)
    const orgResolved = await resolveAppCredential(appId, organizationId, null, ensureFresh)
    if (orgResolved.isErr()) return err(orgResolved.error)
    return ok({
      userConnection: userResolved.value,
      organizationConnection: orgResolved.value,
    })
  }

  // MCP owner: org-scoped only.
  if (mcpServerId) {
    const def = await database.query.ConnectionDefinition.findFirst({
      where: (d, { eq }) => eq(d.mcpServerId, mcpServerId),
      columns: { connectionType: true, authApply: true, baseUrlTemplate: true },
    })
    const found = await findCredential({ organizationId, kind: 'mcp', mcpServerId, userId: null })
    if (found.isErr())
      return err({ code: 'DATABASE_ERROR', message: 'Failed to query MCP credential' })
    if (!found.value) return ok({})
    const resolved = await toRuntimeConnection(
      found.value.id,
      organizationId,
      (def?.connectionType ?? 'secret') as 'oauth2-code' | 'secret',
      ensureFresh,
      { authApply: def?.authApply ?? null, baseUrlTemplate: def?.baseUrlTemplate }
    )
    if (resolved.isErr()) return err(resolved.error)
    return ok({ organizationConnection: resolved.value })
  }

  // Platform provider owner: one definition, scoped by its `global` flag.
  if (providerKey) {
    const def = await database.query.ConnectionDefinition.findFirst({
      where: (d, { eq }) => eq(d.providerKey, providerKey),
      columns: { connectionType: true, global: true, authApply: true, baseUrlTemplate: true },
    })
    if (!def)
      return err({ code: 'CONNECTION_NOT_FOUND', message: `Provider ${providerKey} not found` })

    const scopedUserId = def.global ? null : userId
    const found = await findCredential({
      organizationId,
      kind: 'workflow',
      type: providerKey,
      userId: scopedUserId,
    })
    if (found.isErr()) return err({ code: 'DATABASE_ERROR', message: 'Failed to query credential' })
    if (!found.value) return ok({})
    const resolved = await toRuntimeConnection(
      found.value.id,
      organizationId,
      def.connectionType as 'oauth2-code' | 'secret',
      ensureFresh,
      { authApply: def.authApply, baseUrlTemplate: def.baseUrlTemplate }
    )
    if (resolved.isErr()) return err(resolved.error)
    return ok(
      def.global ? { organizationConnection: resolved.value } : { userConnection: resolved.value }
    )
  }

  return ok({})
}
