// packages/services/src/apps/get-app-details.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for getAppWithInstallationStatus
 */
export interface GetAppWithStatusInput {
  appSlug: string
  organizationId: string
}

/**
 * App details with installation status
 */
export interface AppWithStatusOutput {
  // App details
  app: {
    id: string
    slug: string
    title: string
    description: string | null
    avatarUrl: string | null
    category: string | null
    websiteUrl: string | null
    documentationUrl: string | null
    supportSiteUrl: string | null

    // Content
    overview: string | null
    contentOverview: string | null
    contentHowItWorks: string | null
    contentConfigure: string | null

    // Permissions
    scopes: string[]
    hasOauth: boolean
    hasBundle: boolean

    publicationStatus: string
  }

  // Developer account details
  developerAccount: {
    title: string
    logoUrl: string | null
  }

  // Installation status
  installation: {
    id: string
    isInstalled: boolean
    installationType?: 'development' | 'production'
    installedAt?: Date
    currentDeploymentId?: string
  }

  // Available deployments
  availableDeployments: Array<{
    id: string
    version: string | null
    deploymentType: 'development' | 'production'
    status: string
    createdAt: Date
  }>
}

/**
 * Get detailed app information with installation status for an organization
 *
 * @param input - App slug and organization ID
 * @returns Result with app details, installation status, and available deployments
 */
export async function getAppWithInstallationStatus(input: GetAppWithStatusInput) {
  const { appSlug, organizationId } = input

  // Query app with deployments and developer account
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, appSlug),
      with: {
        developerAccount: true,
        deployments: {
          where: (deployments, { or, and, eq }) =>
            or(
              // Dev deployments for this org
              and(
                eq(deployments.deploymentType, 'development'),
                eq(deployments.targetOrganizationId, organizationId)
              ),
              // Published prod deployments
              and(eq(deployments.deploymentType, 'production'), eq(deployments.status, 'published'))
            ),
          orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
        },
      },
    }),
    'get-app-by-slug'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  // App not found
  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: `App "${appSlug}" not found`,
      appSlug,
    })
  }

  // Check if org has access to this app
  const hasDevDeployments = app.deployments.some(
    (d) => d.deploymentType === 'development' && d.targetOrganizationId === organizationId
  )
  const isPublished = app.publicationStatus === 'published'

  if (!isPublished && !hasDevDeployments) {
    return err({
      code: 'APP_ACCESS_DENIED' as const,
      message: `You do not have access to app "${appSlug}"`,
      appSlug,
      organizationId,
    })
  }

  // Query installation status
  const installationResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (installations, { and, eq, isNull }) =>
        and(
          eq(installations.organizationId, organizationId),
          eq(installations.appId, app.id),
          isNull(installations.uninstalledAt)
        ),
    }),
    'get-installation-status'
  )

  if (installationResult.isErr()) {
    return installationResult
  }

  const installation = installationResult.value

  // Format response
  return ok({
    app: {
      id: app.id,
      slug: app.slug,
      title: app.title,
      description: app.description,
      avatarUrl: app.avatarUrl,
      category: app.category,
      websiteUrl: app.websiteUrl,
      documentationUrl: app.documentationUrl,
      supportSiteUrl: app.supportSiteUrl,
      overview: app.overview,
      contentOverview: app.contentOverview,
      contentHowItWorks: app.contentHowItWorks,
      contentConfigure: app.contentConfigure,
      scopes: (app.scopes as string[]) || [],
      hasOauth: app.hasOauth,
      hasBundle: app.hasBundle,
      publicationStatus: app.publicationStatus,
    },
    developerAccount: {
      title: app.developerAccount.title,
      logoUrl: app.developerAccount.logoUrl,
    },
    installation: {
      id: installation?.id,
      isInstalled: !!installation,
      installationType: installation?.installationType as 'development' | 'production' | undefined,
      installedAt: installation?.installedAt,
      currentDeploymentId: installation?.currentDeploymentId ?? undefined,
    },
    availableDeployments: app.deployments.map((deployment) => ({
      id: deployment.id,
      version: deployment.version,
      deploymentType: deployment.deploymentType as 'development' | 'production',
      status: deployment.status,
      createdAt: deployment.createdAt,
    })),
  })
}
