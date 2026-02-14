// apps/api/src/services/app-installations/get-installation-bundle.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
// import type { AppInstallationError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Get the current bundle for an installation
 * Validates organization handle and app ID match the installation
 *
 * @param params - Object containing installationId, organizationHandle, appId
 * @returns Result with installation and bundle info
 */
export async function getInstallationBundle(params: {
  installationId: string
  organizationHandle: string
  appId: string
}) {
  const { installationId, organizationHandle, appId } = params

  const dbResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (installations, { eq, and }) =>
        and(eq(installations.id, installationId), eq(installations.appId, appId)),
      with: {
        currentVersion: {
          with: {
            bundles: {
              where: (bundles, { eq }) => eq(bundles.isComplete, true),
              orderBy: (bundles, { desc }) => [desc(bundles.completedAt)],
              limit: 1,
            },
          },
        },
        organization: true,
        app: true,
      },
    }),
    'get-installation-bundle'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const installation = dbResult.value

  if (!installation) {
    return err({
      code: 'INSTALLATION_NOT_FOUND' as const,
      message: `Installation not found: ${installationId}`,
      installationId,
    })
  }

  // Verify organization handle matches
  if (installation.organization.handle !== organizationHandle) {
    return err({
      code: 'ORGANIZATION_NOT_FOUND' as const,
      message: `Organization handle mismatch for installation ${installationId}`,
      organizationId: installation.organizationId,
    })
  }

  // Verify app ID matches (already checked in query, but explicit validation)
  if (installation.appId !== appId) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: `App ID mismatch for installation ${installationId}`,
      appId,
    })
  }

  if (!installation.currentVersion) {
    return err({
      code: 'NO_VERSION_INSTALLED' as const,
      message: `Installation ${installationId} has no current version`,
      installationId,
    })
  }

  // Get the latest complete bundle (already filtered and sorted by the query)
  const bundles = installation.currentVersion.bundles || []
  const completeBundle = bundles[0]

  if (!completeBundle) {
    return err({
      code: 'NO_BUNDLE_FOUND' as const,
      message: `No complete bundle found for version ${installation.currentVersion.id}`,
      installationId,
    })
  }

  return ok({
    installation,
    bundle: completeBundle,
  })
}
