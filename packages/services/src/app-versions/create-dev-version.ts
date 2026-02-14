// apps/api/src/services/app-versions/create-dev-version.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
// import type { AppVersionError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Get or create the single dev version for an app+organization.
 * Dev versions are always 1.0.0 and continuously updated with new bundles.
 *
 * Note: Despite the name "create", this function implements get-or-create logic
 * to ensure only ONE dev version exists per app+organization pair.
 *
 * @param params - Object containing version creation parameters
 * @returns Result with version data or an error
 */
export async function createDevVersion(params: {
  appId: string
  targetOrganizationId: string
  environmentVariables: Record<string, string>
  cliVersion: string
  createdById: string
}) {
  const { appId, targetOrganizationId, environmentVariables, cliVersion, createdById } = params

  // Try to find existing dev version for this app+org
  const existingResult = await fromDatabase(
    database.query.AppVersion.findFirst({
      where: (versions, { and, eq }) =>
        and(
          eq(versions.appId, appId),
          eq(versions.targetOrganizationId, targetOrganizationId),
          eq(versions.versionType, 'dev')
        ),
    }),
    'find-existing-dev-version'
  )

  if (existingResult.isErr()) {
    return err(existingResult.error)
  }

  const existing = existingResult.value

  if (existing) {
    // Update environment variables and CLI version
    const updateResult = await fromDatabase(
      database
        .update(schema.AppVersion)
        .set({
          environmentVariables,
          cliVersion,
          updatedAt: new Date(),
        })
        .where(eq(schema.AppVersion.id, existing.id))
        .returning(),
      'update-dev-version'
    )

    if (updateResult.isErr()) {
      return err(updateResult.error)
    }

    const [updated] = updateResult.value
    return ok(updated || existing)
  }

  // Create new dev version (always 1.0.0)
  const dbResult = await fromDatabase(
    database
      .insert(schema.AppVersion)
      .values({
        appId,
        versionType: 'dev',
        major: 1,
        minor: 0, // Always 0 for dev (not incremented)
        patch: 0,
        targetOrganizationId,
        environmentVariables,
        cliVersion,
        createdById,
        status: 'active',
        updatedAt: new Date(),
      })
      .returning(),
    'create-dev-version'
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
      message: `Failed to create dev version for app ${appId}`,
      cause: 'No version returned from insert',
    })
  }

  // Success
  return ok(version)
}
