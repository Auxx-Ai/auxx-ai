// packages/lib/src/connections/resolve-connection-for-runtime.ts
// The one runtime resolver for every connection owner — app, mcp server, or
// platform built-in provider. Collapses resolve-app/resolve-mcp: find the
// ConnectionDefinition, find the Credential, reveal, and lazily refresh oauth2
// tokens. Because it resolves by connectionType (not `kind`), workflow/platform
// credentials get auto-refresh-on-use for free.

import { findCredential, revealSecrets } from '@auxx/credentials/store'
import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  type DecryptedConnectionData,
  mergeConnectionVariables,
} from '@auxx/services/app-connections'
import { err, ok, type Result } from 'neverthrow'
import { ensureFreshCredentialToken } from '../credentials/ensure-fresh-credential-token'

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
  metadata?: any
  expiresAt?: string
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
  ensureFresh: boolean
): Promise<RuntimeConnectionData> {
  const { record, secrets } = await refreshIfNeeded(
    revealed,
    organizationId,
    connectionType,
    ensureFresh
  )
  return {
    id: record.id,
    type: connectionType,
    value: secretValue(secrets),
    fields: connectionFields(record, secrets),
    metadata: record.metadata,
    expiresAt: record.expiresAt?.toISOString(),
  }
}

/** Reveal + refresh + shape a single credential into RuntimeConnectionData. */
async function toRuntimeConnection(
  credentialId: string,
  organizationId: string,
  connectionType: 'oauth2-code' | 'secret',
  ensureFresh: boolean
): Promise<Result<RuntimeConnectionData, ResolveConnectionError>> {
  const revealed = await revealSecrets<ConnectionSecrets>(credentialId, organizationId)
  if (revealed.isErr()) {
    if (revealed.error.code === 'CREDENTIAL_NOT_FOUND') {
      return err({ code: 'CONNECTION_NOT_FOUND', message: `Connection ${credentialId} not found` })
    }
    logger.error('Failed to decrypt credential', { credentialId, error: revealed.error })
    return err({ code: 'DECRYPTION_ERROR', message: 'Failed to decrypt credential' })
  }

  return ok(await shapeFromRevealed(revealed.value, organizationId, connectionType, ensureFresh))
}

type OwnerInput =
  | { appId: string; mcpServerId?: never; providerKey?: never }
  | { mcpServerId: string; appId?: never; providerKey?: never }
  | { providerKey: string; appId?: never; mcpServerId?: never }

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
    connectionId?: string
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
  if (connectionId) {
    const def = await database.query.ConnectionDefinition.findFirst({
      where: (d, { eq, or }) =>
        or(
          appId ? eq(d.appId, appId) : undefined,
          mcpServerId ? eq(d.mcpServerId, mcpServerId) : undefined,
          providerKey ? eq(d.providerKey, providerKey) : undefined
        ),
      columns: { connectionType: true },
    })
    const revealed = await revealSecrets<ConnectionSecrets>(connectionId, organizationId)
    if (revealed.isErr()) {
      return err({ code: 'CONNECTION_NOT_FOUND', message: `Connection ${connectionId} not found` })
    }
    const connectionType = (def?.connectionType ??
      (revealed.value.secrets.accessToken ? 'oauth2-code' : 'secret')) as 'oauth2-code' | 'secret'
    const resolved = await shapeFromRevealed(
      revealed.value,
      organizationId,
      connectionType,
      ensureFresh
    )
    return ok(
      revealed.value.record.userId
        ? { userConnection: resolved }
        : { organizationConnection: resolved }
    )
  }

  // App owner: an app may define both a user-scoped and an org-scoped connection.
  if (appId) {
    const defs = await database.query.ConnectionDefinition.findMany({
      where: (d, { eq }) => eq(d.appId, appId),
      columns: { connectionType: true, global: true },
    })
    const userDef = defs.find((d) => d.global === false)
    const orgDef = defs.find((d) => d.global === true)

    let userConnection: RuntimeConnectionData | undefined
    let organizationConnection: RuntimeConnectionData | undefined

    if (userDef) {
      const found = await findCredential({ organizationId, kind: 'app', appId, userId })
      if (found.isErr())
        return err({ code: 'DATABASE_ERROR', message: 'Failed to query user credential' })
      if (found.value) {
        const resolved = await toRuntimeConnection(
          found.value.id,
          organizationId,
          userDef.connectionType as 'oauth2-code' | 'secret',
          ensureFresh
        )
        if (resolved.isErr()) return err(resolved.error)
        userConnection = resolved.value
      }
    }
    if (orgDef) {
      const found = await findCredential({ organizationId, kind: 'app', appId, userId: null })
      if (found.isErr())
        return err({ code: 'DATABASE_ERROR', message: 'Failed to query organization credential' })
      if (found.value) {
        const resolved = await toRuntimeConnection(
          found.value.id,
          organizationId,
          orgDef.connectionType as 'oauth2-code' | 'secret',
          ensureFresh
        )
        if (resolved.isErr()) return err(resolved.error)
        organizationConnection = resolved.value
      }
    }
    return ok({ userConnection, organizationConnection })
  }

  // MCP owner: org-scoped only.
  if (mcpServerId) {
    const def = await database.query.ConnectionDefinition.findFirst({
      where: (d, { eq }) => eq(d.mcpServerId, mcpServerId),
      columns: { connectionType: true },
    })
    const found = await findCredential({ organizationId, kind: 'mcp', mcpServerId, userId: null })
    if (found.isErr())
      return err({ code: 'DATABASE_ERROR', message: 'Failed to query MCP credential' })
    if (!found.value) return ok({})
    const resolved = await toRuntimeConnection(
      found.value.id,
      organizationId,
      (def?.connectionType ?? 'secret') as 'oauth2-code' | 'secret',
      ensureFresh
    )
    if (resolved.isErr()) return err(resolved.error)
    return ok({ organizationConnection: resolved.value })
  }

  // Platform provider owner: one definition, scoped by its `global` flag.
  if (providerKey) {
    const def = await database.query.ConnectionDefinition.findFirst({
      where: (d, { eq }) => eq(d.providerKey, providerKey),
      columns: { connectionType: true, global: true },
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
      ensureFresh
    )
    if (resolved.isErr()) return err(resolved.error)
    return ok(
      def.global ? { organizationConnection: resolved.value } : { userConnection: resolved.value }
    )
  }

  return ok({})
}
