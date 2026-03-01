// packages/services/src/apps/get-app-deployments.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for getAppDeployments
 */
export interface GetAppDeploymentsInput {
  appSlug: string
  organizationId: string
  filters?: {
    deploymentType?: 'development' | 'production'
    status?: string
  }
}

/**
 * App deployment details
 */
export interface AppDeploymentDetail {
  id: string
  version: string | null
  deploymentType: 'development' | 'production'
  status: string
  releaseNotes: string | null
  createdAt: Date
  isCurrentlyInstalled: boolean
}

/**
 * Success output for getAppDeployments
 */
export interface GetAppDeploymentsOutput {
  app: {
    id: string
    slug: string
    title: string
  }
  deployments: AppDeploymentDetail[]
}

/**
 * Get available deployments for an app
 *
 * @param input - App slug, organization ID, and optional filters
 * @returns Result with app info and list of available deployments
 */
export async function getAppDeployments(input: GetAppDeploymentsInput) {
  const { appSlug, organizationId, filters } = input

  // Query app
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, appSlug),
    }),
    'get-app-by-slug'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: `App "${appSlug}" not found`,
      appSlug,
    })
  }

  // Query deployments with access control
  const deploymentsResult = await fromDatabase(
    database.query.AppDeployment.findMany({
      where: (deployments, { and, or, eq }) => {
        const conditions = [
          eq(deployments.appId, app.id),
          or(
            // Dev deployments for this org
            and(
              eq(deployments.deploymentType, 'development'),
              eq(deployments.targetOrganizationId, organizationId)
            ),
            // Published prod deployments
            and(eq(deployments.deploymentType, 'production'), eq(deployments.status, 'published'))
          )!,
        ]

        // Apply optional filters
        if (filters?.deploymentType) {
          conditions.push(eq(deployments.deploymentType, filters.deploymentType))
        }

        if (filters?.status) {
          conditions.push(eq(deployments.status, filters.status))
        }

        return and(...conditions)
      },
      orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
    }),
    'get-app-deployments'
  )

  if (deploymentsResult.isErr()) {
    return deploymentsResult
  }

  // Query current installation to identify installed deployment
  const installationResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (installations, { and, eq, isNull }) =>
        and(
          eq(installations.appId, app.id),
          eq(installations.organizationId, organizationId),
          isNull(installations.uninstalledAt)
        ),
    }),
    'get-current-installation'
  )

  if (installationResult.isErr()) {
    return installationResult
  }

  const currentInstallation = installationResult.value
  const currentDeploymentId = currentInstallation?.currentDeploymentId

  // Format deployments
  const deployments: AppDeploymentDetail[] = deploymentsResult.value.map((deployment) => ({
    id: deployment.id,
    version: deployment.version,
    deploymentType: deployment.deploymentType as 'development' | 'production',
    status: deployment.status,
    releaseNotes: deployment.releaseNotes,
    createdAt: deployment.createdAt,
    isCurrentlyInstalled: deployment.id === currentDeploymentId,
  }))

  return ok({
    app: {
      id: app.id,
      slug: app.slug,
      title: app.title,
    },
    deployments,
  })
}
