// packages/lib/src/connections/save-connection.ts
// Persist a platform-provider connection (the third owner). The app/mcp owners have
// their own savers (saveAppConnection / saveMcpConnection) that also fan out to
// installation custom-fields / tool-sync; a platform provider is just a Credential —
// `kind:'workflow'`, `type:<providerKey>`, linked to its ConnectionDefinition — so this
// is the lean equivalent the unified OAuth route calls.

import {
  insertCredential,
  listCredentials,
  recordRefreshSuccess,
  rotateSecrets,
  updateCredential,
} from '@auxx/credentials/store'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { mergeManualConnectionEdit } from './merge-manual-edit'

const logger = createScopedLogger('save-connection')

export interface SaveConnectionInput {
  /** The provider blueprint this credential binds to. */
  connectionDefinitionId: string
  /** Platform provider key — stored as `Credential.type` so the runtime resolver can find it. */
  providerKey: string
  /** Display name for the credential (e.g. "Google"). */
  name: string
  organizationId: string
  createdById: string
  /**
   * `null` → org-scoped (the definition's `global:true`); a string → user-scoped.
   * Must match the definition's `global` flag — the resolver queries the credential by it.
   */
  userId: string | null
  connectionData: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
    secret?: string
    /** Secret-flagged connection variables (encrypted under `secrets.fields`). */
    secretFields?: Record<string, string>
    /** Plaintext companion data (scope, token type, plain connection variables). */
    metadata?: Record<string, unknown>
  }
  /** Reconnect: rotate the existing row instead of inserting a new one. */
  connectionId?: string
}

/**
 * Pick the secret keys (present only) out of the connection data. Secret-flagged variables nest
 * under `fields` so user-defined keys never collide with the reserved token keys.
 */
function pickSecrets(data: SaveConnectionInput['connectionData']): Record<string, unknown> {
  const secrets: Record<string, unknown> = {}
  if (data.accessToken !== undefined) secrets.accessToken = data.accessToken
  if (data.refreshToken !== undefined) secrets.refreshToken = data.refreshToken
  if (data.secret !== undefined) secrets.secret = data.secret
  if (data.secretFields !== undefined) secrets.fields = data.secretFields
  return secrets
}

/**
 * Save a platform-provider connection (OAuth callback or manual secret). Upserts: a `connectionId`
 * rotates the existing row (reconnect) and resets its refresh circuit breaker; otherwise inserts a
 * new `kind:'workflow'` credential typed by `providerKey` and linked to its ConnectionDefinition.
 */
export async function saveConnection(input: SaveConnectionInput): Promise<Result<string, Error>> {
  const { organizationId } = input
  const secrets = pickSecrets(input.connectionData)
  const metadata = (input.connectionData.metadata ?? {}) as Record<string, unknown>
  const expiresAt = input.connectionData.expiresAt ? new Date(input.connectionData.expiresAt) : null

  if (input.connectionId) {
    // OAuth mint (the callback route) carries fresh tokens and legitimately replaces everything;
    // a manual secret edit carries only secretFields/secret + plain vars and must MERGE so it never
    // wipes the stored secret or drops a plain var the user didn't re-supply.
    const isOAuthMint =
      input.connectionData.accessToken !== undefined ||
      input.connectionData.refreshToken !== undefined

    if (isOAuthMint) {
      const rotated = await rotateSecrets(input.connectionId, organizationId, secrets, {
        expiresAt,
      })
      if (rotated.isErr()) return err(rotated.error)

      const metaUpdated = await updateCredential(input.connectionId, organizationId, { metadata })
      if (metaUpdated.isErr()) return err(metaUpdated.error)
    } else {
      const reconnected = await mergeManualConnectionEdit(input.connectionId, organizationId, {
        secretFields: input.connectionData.secretFields,
        secret: input.connectionData.secret,
        plainVariables: (metadata.connectionVariables ?? {}) as Record<string, unknown>,
      })
      if (reconnected.isErr()) return err(reconnected.error)
    }

    // Clear any open refresh breaker so the freshly re-authed connection stops surfacing as expired.
    const breakerReset = await recordRefreshSuccess(input.connectionId, organizationId, {
      expiresAt,
    })
    if (breakerReset.isErr()) return err(breakerReset.error)

    logger.info('Reconnected platform connection', {
      credentialId: input.connectionId,
      mode: isOAuthMint ? 'replace' : 'merge',
    })
    return ok(input.connectionId)
  }

  const label = await dedupeLabel(input.name, {
    organizationId,
    providerKey: input.providerKey,
    userId: input.userId,
  })

  const created = await insertCredential({
    organizationId,
    createdById: input.createdById,
    kind: 'workflow',
    type: input.providerKey,
    connectionDefinitionId: input.connectionDefinitionId,
    userId: input.userId,
    name: input.name,
    label,
    secrets,
    metadata,
    expiresAt,
  })

  if (created.isErr()) return err(created.error)

  logger.info('Created platform connection', {
    credentialId: created.value.id,
    providerKey: input.providerKey,
    global: input.userId === null,
  })
  return ok(created.value.id)
}

/**
 * Make a label unique within its (provider, scope) by appending the lowest free `(n)` suffix.
 * Scope mirrors how the resolver/UI partition rows: org-wide (`userId === null`) vs a single user.
 */
async function dedupeLabel(
  desired: string,
  scope: { organizationId: string; providerKey: string; userId: string | null }
): Promise<string> {
  const existing = await listCredentials({
    organizationId: scope.organizationId,
    kind: 'workflow',
    type: scope.providerKey,
    userId: scope.userId,
  })

  const taken = new Set(
    (existing.isOk() ? existing.value : []).map((row) => row.label).filter((l): l is string => !!l)
  )

  if (!taken.has(desired)) return desired
  let n = 2
  while (taken.has(`${desired} (${n})`)) n++
  return `${desired} (${n})`
}
