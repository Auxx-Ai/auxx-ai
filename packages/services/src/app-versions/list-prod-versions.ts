// apps/api/src/services/app-versions/list-prod-versions.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
// import type { AppVersionError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * List all production versions for an app
 *
 * @param params - Object containing appId
 * @returns Result with array of versions or an error
 */
export async function listProdVersions(params: { appId: string }) {
  const { appId } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.AppVersion.findMany({
      where: (versions, { and, eq }) =>
        and(eq(versions.appId, appId), eq(versions.versionType, 'prod')),
      orderBy: (versions, { desc }) => [desc(versions.major), desc(versions.minor)],
    }),
    'list-prod-versions'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  // Success
  return ok(dbResult.value)
}
