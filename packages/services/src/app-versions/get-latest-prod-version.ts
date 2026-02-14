// apps/api/src/services/app-versions/get-latest-prod-version.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
// import type { AppVersionError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Get the latest prod version for a specific major version
 *
 * @param params - Object containing appId and major version
 * @returns Result with version data (may be null if no versions exist) or an error
 */
export async function getLatestProdVersion(params: { appId: string; major: number }) {
  const { appId, major } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.AppVersion.findFirst({
      where: (versions, { and, eq }) =>
        and(eq(versions.appId, appId), eq(versions.versionType, 'prod'), eq(versions.major, major)),
      orderBy: (versions, { desc }) => [desc(versions.minor)],
    }),
    'get-latest-prod-version'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  // Success (version may be null if no versions exist)
  return ok(dbResult.value)
}
