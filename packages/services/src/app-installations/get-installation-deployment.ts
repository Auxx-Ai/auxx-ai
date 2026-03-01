// packages/services/src/app-installations/get-installation-deployment.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Get the current deployment for an installation.
 * Replaces getInstallationBundle — no more completedAt DESC fragility.
 *
 * The deployment's bundle references are set once at creation and never change.
 *
 * @param params - Object containing installationId, organizationHandle, appId
 * @returns Result with deployment info including bundle SHAs
 */
export async function getInstallationDeployment(params: {
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
        currentDeployment: {
          with: {
            serverBundle: true,
            clientBundle: true,
          },
        },
        organization: true,
        app: true,
      },
    }),
    'get-installation-deployment'
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

  if (!installation.currentDeployment) {
    return err({
      code: 'NO_DEPLOYMENT_ACTIVE' as const,
      message: `Installation ${installationId} has no active deployment`,
      installationId,
    })
  }

  return ok({
    installation,
    deployment: installation.currentDeployment,
    deploymentId: installation.currentDeployment.id,
    appId: installation.appId,
    serverBundleSha: installation.currentDeployment.serverBundle.sha256,
    clientBundleSha: installation.currentDeployment.clientBundle.sha256,
    settingsSchema: installation.currentDeployment.settingsSchema,
    environmentVariables: installation.currentDeployment.environmentVariables,
  })
}
