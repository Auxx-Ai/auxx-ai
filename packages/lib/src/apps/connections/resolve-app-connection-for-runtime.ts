// packages/lib/src/apps/connections/resolve-app-connection-for-runtime.ts

import { findCredential, revealSecrets } from '@auxx/credentials/store'
import { database } from '@auxx/database'
import {
  type DecryptedConnectionData,
  logger,
  mergeConnectionVariables,
} from '@auxx/services/app-connections'
import { fromDatabase } from '@auxx/services/shared/utils'
import { err, ok } from 'neverthrow'
import { ensureFreshCredentialToken } from '../../credentials/ensure-fresh-credential-token'

/** Secrets no longer carry expiry/metadata — those come from the record columns. */
type ConnectionSecrets = Pick<
  DecryptedConnectionData,
  'accessToken' | 'refreshToken' | 'secret' | 'fields'
>

/** The reveal-call value, narrowed to the record fields this resolver reads. */
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

/**
 * Connection data passed to the app runtime executor — the decrypted credential value plus the
 * non-secret metadata/expiry the SDK needs. `value` is the access token (oauth2-code) or API
 * secret (secret); `fields` is the merged connection-variable map (plain metadata variables +
 * decrypted secret-flagged ones).
 */
export interface RuntimeConnectionData {
  id: string
  type: 'oauth2-code' | 'secret'
  value: string
  fields?: Record<string, string>
  metadata?: any
  expiresAt?: string
}

function secretValue(secrets: ConnectionSecrets): string {
  return secrets.accessToken || secrets.secret || ''
}

/** The merged connection-variable map, or undefined when the connection has none. */
function connectionFields(
  record: { metadata: any },
  secrets: ConnectionSecrets
): Record<string, string> | undefined {
  const fields = mergeConnectionVariables(record.metadata, secrets)
  return Object.keys(fields).length > 0 ? fields : undefined
}

/**
 * Lazy refresh, mirroring `resolveMcpConnectionForRuntime`: for an `oauth2-code` connection with a
 * stored refresh token, refresh the access token if it is at/near expiry (single-flight, never
 * throws) and re-reveal the rotated secrets. The hot path (fresh token, or `secret`-type, or
 * `ensureFresh: false`) stays at the single reveal the caller already did.
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

/**
 * Resolve app connections for runtime execution.
 *
 * Fetches and decrypts both user-scoped and organization-scoped connections for an app,
 * preparing them for use in the runtime execution environment. Non-secret fields (scopes,
 * account email, …) come from `record.metadata`; `expiresAt` from the column.
 *
 * For `oauth2-code` connections with a refresh token, the access token is refreshed inline when
 * it is at/near expiry (see {@link refreshIfNeeded}). Pass `ensureFresh: false` to skip the
 * refresh — used by the reconnect/authorize route, which only reads `metadata.connectionVariables`.
 */
export async function resolveAppConnectionForRuntime(input: {
  appId: string
  organizationId: string
  userId: string
  connectionId?: string
  /** Skip the lazy OAuth refresh (default `true`). */
  ensureFresh?: boolean
}) {
  const { appId, organizationId, userId, connectionId, ensureFresh = true } = input

  logger.info('resolveAppConnectionForRuntime', { appId, organizationId, userId, connectionId })

  // If connectionId provided, resolve that specific credential directly
  if (connectionId) {
    const revealed = await revealSecrets<ConnectionSecrets>(connectionId, organizationId)
    if (revealed.isErr()) {
      if (revealed.error.code === 'CREDENTIAL_NOT_FOUND') {
        return err({
          code: 'CONNECTION_NOT_FOUND',
          message: `Connection ${connectionId} not found`,
        })
      }
      logger.error('Failed to reveal credential by ID', {
        error: revealed.error,
        credentialId: connectionId,
      })
      return err({ code: 'DECRYPTION_ERROR', message: 'Failed to decrypt credential' })
    }

    if (revealed.value.record.kind !== 'app') {
      return err({ code: 'CONNECTION_NOT_FOUND', message: `Connection ${connectionId} not found` })
    }

    // Determine connection type from connection definition
    const connDefResult = await fromDatabase(
      database.query.ConnectionDefinition.findFirst({
        where: (connDef, { eq }) => eq(connDef.appId, appId),
        columns: { connectionType: true },
      }),
      'get-connection-definition-for-id'
    )

    const connectionType =
      connDefResult.isOk() && connDefResult.value
        ? (connDefResult.value.connectionType as 'oauth2-code' | 'secret')
        : revealed.value.secrets.accessToken
          ? 'oauth2-code'
          : 'secret'

    const { record, secrets } = await refreshIfNeeded(
      revealed.value,
      organizationId,
      connectionType,
      ensureFresh
    )

    const resolved: RuntimeConnectionData = {
      id: record.id,
      type: connectionType,
      value: secretValue(secrets),
      fields: connectionFields(record, secrets),
      metadata: record.metadata,
      expiresAt: record.expiresAt?.toISOString(),
    }

    // Return as organizationConnection if org-scoped, userConnection if user-scoped
    if (record.userId) {
      return ok({ userConnection: resolved, organizationConnection: undefined })
    }
    return ok({ userConnection: undefined, organizationConnection: resolved })
  }

  // 1. Get connection definitions for this app
  // Try user-scoped first (global: false)
  const userConnDefResult = await fromDatabase(
    database.query.ConnectionDefinition.findFirst({
      where: (connDef, { eq, and }) => and(eq(connDef.appId, appId), eq(connDef.global, false)),
      columns: {
        id: true,
        connectionType: true,
      },
    }),
    'get-user-connection-definition'
  )

  if (userConnDefResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to query user connection definition',
    })
  }

  // Try organization-scoped (global: true)
  const orgConnDefResult = await fromDatabase(
    database.query.ConnectionDefinition.findFirst({
      where: (connDef, { eq, and }) => and(eq(connDef.appId, appId), eq(connDef.global, true)),
      columns: {
        id: true,
        connectionType: true,
      },
    }),
    'get-org-connection-definition'
  )

  if (orgConnDefResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to query organization connection definition',
    })
  }

  const userConnDef = userConnDefResult.value
  const orgConnDef = orgConnDefResult.value

  let userConnection: RuntimeConnectionData | undefined
  let organizationConnection: RuntimeConnectionData | undefined

  // 2. Fetch user connection (if app has user-scoped definition)
  if (userConnDef) {
    const userResult = await findCredential({ organizationId, kind: 'app', appId, userId })
    if (userResult.isErr()) {
      return err({ code: 'DATABASE_ERROR', message: 'Failed to query user credential' })
    }

    const userRecord = userResult.value
    if (userRecord) {
      const revealed = await revealSecrets<ConnectionSecrets>(userRecord.id, organizationId)
      if (revealed.isErr()) {
        logger.error('Failed to decrypt user credential', {
          error: revealed.error,
          credentialId: userRecord.id,
        })
        return err({ code: 'DECRYPTION_ERROR', message: 'Failed to decrypt user credential' })
      }

      const connectionType = userConnDef.connectionType as 'oauth2-code' | 'secret'
      const { record, secrets } = await refreshIfNeeded(
        revealed.value,
        organizationId,
        connectionType,
        ensureFresh
      )

      userConnection = {
        id: record.id,
        type: connectionType,
        value: secretValue(secrets),
        fields: connectionFields(record, secrets),
        metadata: record.metadata,
        expiresAt: record.expiresAt?.toISOString(),
      }

      logger.info('User connection resolved', { credentialId: record.id })
    }
  }

  // 3. Fetch organization connection (if app has org-scoped definition)
  if (orgConnDef) {
    const orgResult = await findCredential({ organizationId, kind: 'app', appId, userId: null })
    if (orgResult.isErr()) {
      return err({ code: 'DATABASE_ERROR', message: 'Failed to query organization credential' })
    }

    const orgRecord = orgResult.value
    if (orgRecord) {
      const revealed = await revealSecrets<ConnectionSecrets>(orgRecord.id, organizationId)
      if (revealed.isErr()) {
        logger.error('Failed to decrypt organization credential', {
          error: revealed.error,
          credentialId: orgRecord.id,
        })
        return err({
          code: 'DECRYPTION_ERROR',
          message: 'Failed to decrypt organization credential',
        })
      }

      const connectionType = orgConnDef.connectionType as 'oauth2-code' | 'secret'
      const { record, secrets } = await refreshIfNeeded(
        revealed.value,
        organizationId,
        connectionType,
        ensureFresh
      )

      organizationConnection = {
        id: record.id,
        type: connectionType,
        value: secretValue(secrets),
        fields: connectionFields(record, secrets),
        metadata: record.metadata,
        expiresAt: record.expiresAt?.toISOString(),
      }

      logger.info('Organization connection resolved', { credentialId: record.id })
    }
  }

  return ok({ userConnection, organizationConnection })
}
