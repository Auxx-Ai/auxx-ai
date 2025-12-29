// apps/api/src/services/app-installations/get-dev-installation.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
// import type { AppInstallationError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Get development installation for an app in an organization
 *
 * @param params - Object containing appId and organizationId
 * @returns Result with installation data or an error
 */
export async function getDevInstallation(params: { appId: string; organizationId: string }) {
  const { appId, organizationId } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (installations, { and, eq }) =>
        and(
          eq(installations.appId, appId),
          eq(installations.organizationId, organizationId),
          eq(installations.installationType, 'development')
        ),
    }),
    'get-dev-installation'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const installation = dbResult.value

  // Installation not found
  if (!installation) {
    return err({
      code: 'INSTALLATION_NOT_FOUND' as const,
      message: `Development installation not found for app ${appId} in organization ${organizationId}`,
      appId,
      organizationId,
    })
  }

  // Success
  return ok(installation)
}
