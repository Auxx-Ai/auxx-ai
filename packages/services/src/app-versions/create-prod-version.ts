// apps/api/src/services/app-versions/create-prod-version.ts

import { database, schema } from '@auxx/database'
import { ok, err } from 'neverthrow'
// import type { AppVersionError } from './errors'
import { fromDatabase } from '../shared/utils'
import { getLatestProdVersion } from './get-latest-prod-version'

/**
 * Create a new production version
 *
 * @param params - Object containing version creation parameters
 * @returns Result with version data or an error
 */
export async function createProdVersion(params: {
  appId: string
  major: number
  cliVersion: string
  createdById: string
}) {
  const { appId, major, cliVersion, createdById } = params

  // Get latest version to determine next minor version
  const latestResult = await getLatestProdVersion({ appId, major })
  if (latestResult.isErr()) {
    return err(latestResult.error)
  }

  const latest = latestResult.value
  const nextMinor = latest ? (latest.minor ?? 0) + 1 : 0

  // Create version record
  const dbResult = await fromDatabase(
    database
      .insert(schema.AppVersion)
      .values({
        appId,
        versionType: 'prod',
        major,
        minor: nextMinor,
        patch: 0,
        cliVersion,
        publicationStatus: 'unpublished',
        reviewStatus: null, // Not yet submitted for review
        numInstallations: 0,
        createdById,
        status: 'draft',
        updatedAt: new Date(),
      })
      .returning(),
    'create-prod-version'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const [version] = dbResult.value

  // Version creation failed
  if (!version) {
    return err({
      code: 'CREATE_FAILED' as const,
      message: `Failed to create prod version for app ${appId}`,
      cause: 'No version returned from insert',
    })
  }

  // Success
  return ok(version)
}
