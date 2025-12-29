// packages/services/src/app-connections/get-app-connection-definition.ts

import { database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Get connection definition for an app installation
 *
 * Retrieves the connection definition metadata for a specific app version and scope.
 * Connection definitions are stored in the database and define what type of authentication
 * an app requires (OAuth2, secret, or none) and whether the connection is user-scoped
 * or organization-scoped.
 *
 * This function is typically called when:
 * - Displaying connection setup UI to users
 * - Determining what authentication flow to initiate
 * - Validating that an app has proper connection definitions before installation
 *
 * The function only returns public-facing fields (label, global, connectionType) and
 * excludes sensitive configuration like OAuth2 client secrets and redirect URLs.
 *
 * @param {string} appId - The unique identifier of the app.
 * @param {number} versionMajor - The major version number of the app (e.g., 1 for v1.2.3).
 *                                Connection definitions are versioned with apps to allow
 *                                different versions to have different auth requirements.
 * @param {boolean} global - Whether to retrieve the organization-scoped (true) or
 *                           user-scoped (false) connection definition.
 *                           - true: Connection shared across all users in the organization
 *                           - false: Connection specific to individual users
 *
 * @returns A Result containing either:
 *          - Success: Object with label, global flag, and connectionType
 *          - Error: Database error or CONNECTION_DEFINITION_NOT_FOUND if no definition exists
 *
 * @example
 * // Get organization-scoped connection definition for Gmail app v1
 * const result = await getAppConnectionDefinition('gmail-app-id', 1, true)
 * if (result.isOk()) {
 *   const def = result.value
 *   console.log(def.label) // "Gmail Account"
 *   console.log(def.connectionType) // "oauth2-code"
 * }
 *
 * @example
 * // Get user-scoped connection definition
 * const result = await getAppConnectionDefinition('slack-app-id', 2, false)
 * if (result.isErr()) {
 *   console.error('Connection definition not found')
 * }
 */
export async function getAppConnectionDefinition(
  appId: string,
  versionMajor: number,
  global: boolean
) {
  const definitionResult = await fromDatabase(
    database.query.ConnectionDefinition.findFirst({
      where: (connDef, { eq, and }) =>
        and(eq(connDef.appId, appId), eq(connDef.major, versionMajor), eq(connDef.global, global)),
      columns: {
        label: true,
        global: true,
        connectionType: true,
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
      versionMajor,
      global,
    })
  }

  return ok(definition)
}
