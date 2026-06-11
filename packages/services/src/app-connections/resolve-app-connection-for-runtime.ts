// packages/services/src/app-connections/resolve-app-connection-for-runtime.ts

import { findCredential, revealSecrets } from '@auxx/credentials/store'
import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { DecryptedConnectionData, RuntimeConnectionData } from './types'
import { logger } from './utils'

/** Secrets no longer carry expiry/metadata — those come from the record columns. */
type ConnectionSecrets = Pick<DecryptedConnectionData, 'accessToken' | 'refreshToken' | 'secret'>

function secretValue(secrets: ConnectionSecrets): string {
  return secrets.accessToken || secrets.secret || ''
}

/**
 * Resolve app connections for runtime execution.
 *
 * Fetches and decrypts both user-scoped and organization-scoped connections for an app,
 * preparing them for use in the runtime execution environment. Non-secret fields (scopes,
 * account email, …) come from `record.metadata`; `expiresAt` from the column.
 */
export async function resolveAppConnectionForRuntime(input: {
  appId: string
  organizationId: string
  userId: string
  connectionId?: string
}) {
  const { appId, organizationId, userId, connectionId } = input

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

    const { record, secrets } = revealed.value
    if (record.kind !== 'app') {
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
        : secrets.accessToken
          ? 'oauth2-code'
          : 'secret'

    const resolved: RuntimeConnectionData = {
      id: record.id,
      type: connectionType,
      value: secretValue(secrets),
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

      userConnection = {
        id: userRecord.id,
        type: userConnDef.connectionType as 'oauth2-code' | 'secret',
        value: secretValue(revealed.value.secrets),
        metadata: userRecord.metadata,
        expiresAt: userRecord.expiresAt?.toISOString(),
      }

      logger.info('User connection resolved', { credentialId: userRecord.id })
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

      organizationConnection = {
        id: orgRecord.id,
        type: orgConnDef.connectionType as 'oauth2-code' | 'secret',
        value: secretValue(revealed.value.secrets),
        metadata: orgRecord.metadata,
        expiresAt: orgRecord.expiresAt?.toISOString(),
      }

      logger.info('Organization connection resolved', { credentialId: orgRecord.id })
    }
  }

  return ok({ userConnection, organizationConnection })
}
