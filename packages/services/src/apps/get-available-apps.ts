// packages/services/src/apps/get-available-apps.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for getAvailableApps
 */
export interface GetAvailableAppsInput {
  organizationId: string
  filters?: {
    category?: string
    publicationStatus?: 'unpublished' | 'published'
    searchQuery?: string
  }
  pagination?: {
    limit?: number
    offset?: number
  }
}

/**
 * App details with installation status
 */
export interface AvailableApp {
  id: string
  slug: string
  title: string
  description: string | null
  avatarId: string | null
  avatarUrl: string | null
  category: string | null
  websiteUrl: string | null
  documentationUrl: string | null
  contactUrl: string | null
  supportSiteUrl: string | null
  termsOfServiceUrl: string | null
  overview: string | null
  contentOverview: string | null
  contentHowItWorks: string | null
  contentConfigure: string | null
  scopes: string[]
  hasOauth: boolean
  oauthExternalEntrypointUrl: string | null
  isDevelopment: boolean
  isPublished: boolean
  isInstalled: boolean
  installationType?: 'development' | 'production'
  installedDeploymentId?: string
  developerAccount: {
    title: string
    logoUrl: string | null
  }
  latestDeployment?: {
    id: string
    version: string | null
    status: string
  }
}

/**
 * Success output for getAvailableApps
 */
export interface GetAvailableAppsOutput {
  apps: AvailableApp[]
  total: number
}

/**
 * Get all apps available to an organization (published marketplace apps + dev apps targeting this org)
 */
export async function getAvailableApps(input: GetAvailableAppsInput) {
  const { organizationId, filters, pagination } = input
  const limit = pagination?.limit ?? 20
  const offset = pagination?.offset ?? 0

  // Query published marketplace apps
  const publishedAppsResult = await fromDatabase(
    database.query.App.findMany({
      where: (apps, { eq, and, like, or }) => {
        const conditions = [eq(apps.publicationStatus, 'published')]

        if (filters?.category) {
          conditions.push(eq(apps.category, filters.category))
        }

        if (filters?.searchQuery) {
          conditions.push(
            or(
              like(apps.title, `%${filters.searchQuery}%`),
              like(apps.description, `%${filters.searchQuery}%`)
            )!
          )
        }

        return and(...conditions)
      },
      with: {
        developerAccount: true,
        deployments: {
          where: (deployments, { eq, and }) =>
            and(eq(deployments.deploymentType, 'production'), eq(deployments.status, 'published')),
          orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
          limit: 1,
        },
      },
    }),
    'get-published-apps'
  )

  if (publishedAppsResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR' as const,
      message: publishedAppsResult.error.message,
      cause: publishedAppsResult.error.cause,
    })
  }

  // Query dev apps targeting this organization
  const devAppsResult = await fromDatabase(
    database.query.App.findMany({
      with: {
        developerAccount: true,
        deployments: {
          where: (deployments, { eq, and }) =>
            and(
              eq(deployments.deploymentType, 'development'),
              eq(deployments.targetOrganizationId, organizationId),
              eq(deployments.status, 'active')
            ),
          orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
          limit: 1,
        },
      },
    }),
    'get-dev-apps'
  )

  if (devAppsResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR' as const,
      message: devAppsResult.error.message,
      cause: devAppsResult.error.cause,
    })
  }

  // Filter dev apps that have at least one deployment for this org
  const devApps = devAppsResult.value.filter((app) => app.deployments.length > 0)

  // Query installations for this organization
  const installationsResult = await fromDatabase(
    database.query.AppInstallation.findMany({
      where: (installations, { eq, and, isNull }) =>
        and(eq(installations.organizationId, organizationId), isNull(installations.uninstalledAt)),
    }),
    'get-installations'
  )

  if (installationsResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR' as const,
      message: installationsResult.error.message,
      cause: installationsResult.error.cause,
    })
  }

  // Create a map of installations by appId + type for quick lookup
  const installationMap = new Map(
    installationsResult.value.map((inst) => [
      `${inst.appId}:${inst.installationType}`,
      {
        installationType: inst.installationType,
        installedDeploymentId: inst.currentDeploymentId,
      },
    ])
  )

  // Combine published and dev apps, deduplicating by app ID
  const appsMap = new Map<string, (typeof publishedAppsResult.value)[0]>()

  for (const app of publishedAppsResult.value) {
    appsMap.set(app.id, app)
  }

  // Dev apps take priority
  for (const app of devApps) {
    appsMap.set(app.id, app)
  }

  const allApps = Array.from(appsMap.values())

  // Format apps with installation status
  const formattedApps: AvailableApp[] = allApps.map((app) => {
    const latestDeployment = app.deployments[0]

    const isDev = app.deployments.some((d) => d.deploymentType === 'development')
    const installationType = isDev ? 'development' : 'production'
    const installation = installationMap.get(`${app.id}:${installationType}`)

    return {
      id: app.id,
      slug: app.slug,
      title: app.title,
      description: app.description,
      avatarId: app.avatarId,
      avatarUrl: app.avatarUrl,
      category: app.category,
      websiteUrl: app.websiteUrl,
      documentationUrl: app.documentationUrl,
      contactUrl: app.contactUrl,
      supportSiteUrl: app.supportSiteUrl,
      termsOfServiceUrl: app.termsOfServiceUrl,
      overview: app.overview,
      contentOverview: app.contentOverview,
      contentHowItWorks: app.contentHowItWorks,
      contentConfigure: app.contentConfigure,
      scopes: app.scopes ?? [],
      hasOauth: app.hasOauth ?? false,
      oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
      isDevelopment: isDev,
      isPublished: app.publicationStatus === 'published',
      isInstalled: !!installation,
      installationType: installation?.installationType as 'development' | 'production' | undefined,
      installedDeploymentId: installation?.installedDeploymentId ?? undefined,
      developerAccount: {
        title: app.developerAccount.title,
        logoUrl: app.developerAccount.logoUrl,
      },
      latestDeployment: latestDeployment
        ? {
            id: latestDeployment.id,
            version: latestDeployment.version,
            status: latestDeployment.status,
          }
        : undefined,
    }
  })

  // Apply pagination
  const paginatedApps = formattedApps.slice(offset, offset + limit)

  return ok({
    apps: paginatedApps,
    total: formattedApps.length,
  })
}
