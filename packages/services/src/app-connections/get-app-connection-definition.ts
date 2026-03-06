// packages/services/src/app-connections/get-app-connection-definition.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Get connection definition for an app installation.
 *
 * Retrieves the connection definition metadata for an app and scope.
 * Connection definitions define what type of authentication an app requires
 * (OAuth2, secret, or none) and whether the connection is user-scoped or
 * organization-scoped.
 *
 * @param appId - The unique identifier of the app.
 * @param global - Whether to retrieve the organization-scoped (true) or user-scoped (false) definition.
 */
export async function getAppConnectionDefinition(appId: string, global: boolean) {
  const definitionResult = await fromDatabase(
    database.query.ConnectionDefinition.findFirst({
      where: (connDef, { eq, and }) => and(eq(connDef.appId, appId), eq(connDef.global, global)),
      columns: {
        label: true,
        global: true,
        connectionType: true,
        oauth2Features: true,
      },
    }),
    'get-connection-definition'
  )

  if (definitionResult.isErr()) {
    return definitionResult
  }

  const definition = definitionResult.value

  if (!definition) {
    return err({
      code: 'CONNECTION_DEFINITION_NOT_FOUND',
      message: 'Connection definition not found',
      appId,
      global,
    })
  }

  return ok(definition)
}
