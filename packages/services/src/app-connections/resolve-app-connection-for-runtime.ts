// packages/services/src/app-connections/resolve-app-connection-for-runtime.ts

import { CredentialService } from '@auxx/credentials'
import { database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { DecryptedConnectionData, RuntimeConnectionData } from './types'
import { logger } from './utils'

/**
 * Resolve app connections for runtime execution.
 *
 * Fetches and decrypts both user-scoped and organization-scoped connections for an app,
 * preparing them for use in the runtime execution environment.
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
    const credResult = await fromDatabase(
      database.query.WorkflowCredentials.findFirst({
        where: (creds, { eq, and }) =>
          and(
            eq(creds.id, connectionId),
            eq(creds.organizationId, organizationId),
            eq(creds.type, 'app-connection')
          ),
      }),
      'get-connection-by-id'
    )

    if (credResult.isErr()) {
      return err({ code: 'DATABASE_ERROR', message: 'Failed to query connection by ID' })
    }

    const cred = credResult.value
    if (!cred) {
      return err({ code: 'CONNECTION_NOT_FOUND', message: `Connection ${connectionId} not found` })
    }

    try {
      const decryptedData = CredentialService.decrypt(cred.encryptedData) as DecryptedConnectionData

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
          : decryptedData.accessToken
            ? 'oauth2-code'
            : 'secret'

      const resolved: RuntimeConnectionData = {
        id: cred.id,
        type: connectionType,
        value: decryptedData.accessToken || decryptedData.secret || '',
        metadata: decryptedData.metadata,
        expiresAt: decryptedData.expiresAt,
      }

      // Return as organizationConnection if org-scoped, userConnection if user-scoped
      if (cred.userId) {
        return ok({ userConnection: resolved, organizationConnection: undefined })
      }
      return ok({ userConnection: undefined, organizationConnection: resolved })
    } catch (error) {
      logger.error('Failed to decrypt credential by ID', { error, credentialId: cred.id })
      return err({ code: 'DECRYPTION_ERROR', message: 'Failed to decrypt credential' })
    }
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
    const userCredResult = await fromDatabase(
      database.query.WorkflowCredentials.findFirst({
        where: (creds, { eq, and }) =>
          and(
            eq(creds.appId, appId),
            eq(creds.organizationId, organizationId),
            eq(creds.userId, userId),
            eq(creds.type, 'app-connection')
          ),
      }),
      'get-user-credential'
    )

    if (userCredResult.isErr()) {
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to query user credential',
      })
    }

    const userCred = userCredResult.value

    if (userCred) {
      try {
        // Decrypt using CredentialService
        const decryptedData = CredentialService.decrypt(
          userCred.encryptedData
        ) as DecryptedConnectionData

        userConnection = {
          id: userCred.id,
          type: userConnDef.connectionType as 'oauth2-code' | 'secret',
          value: decryptedData.accessToken || decryptedData.secret || '',
          metadata: decryptedData.metadata,
          expiresAt: decryptedData.expiresAt,
        }

        logger.info('User connection resolved', { credentialId: userCred.id })
      } catch (error) {
        logger.error('Failed to decrypt user credential', { error, credentialId: userCred.id })
        return err({
          code: 'DECRYPTION_ERROR',
          message: 'Failed to decrypt user credential',
        })
      }
    }
  }

  // 3. Fetch organization connection (if app has org-scoped definition)
  if (orgConnDef) {
    const orgCredResult = await fromDatabase(
      database.query.WorkflowCredentials.findFirst({
        where: (creds, { eq, and, isNull }) =>
          and(
            eq(creds.appId, appId),
            eq(creds.organizationId, organizationId),
            isNull(creds.userId), // Organization connection has no userId
            eq(creds.type, 'app-connection')
          ),
      }),
      'get-org-credential'
    )

    if (orgCredResult.isErr()) {
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to query organization credential',
      })
    }

    const orgCred = orgCredResult.value

    if (orgCred) {
      try {
        const decryptedData = CredentialService.decrypt(
          orgCred.encryptedData
        ) as DecryptedConnectionData

        organizationConnection = {
          id: orgCred.id,
          type: orgConnDef.connectionType as 'oauth2-code' | 'secret',
          value: decryptedData.accessToken || decryptedData.secret || '',
          metadata: decryptedData.metadata,
          expiresAt: decryptedData.expiresAt,
        }

        logger.info('Organization connection resolved', { credentialId: orgCred.id })
      } catch (error) {
        logger.error('Failed to decrypt organization credential', {
          error,
          credentialId: orgCred.id,
        })
        return err({
          code: 'DECRYPTION_ERROR',
          message: 'Failed to decrypt organization credential',
        })
      }
    }
  }

  return ok({ userConnection, organizationConnection })
}
