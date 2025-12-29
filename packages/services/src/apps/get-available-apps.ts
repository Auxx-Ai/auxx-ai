// packages/services/src/apps/get-available-apps.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
// import type { AppError } from './errors'
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
  // App details
  id: string
  slug: string
  title: string
  description: string | null

  // Avatar
  avatarId: string | null
  avatarUrl: string | null

  // Marketplace listing
  category: string | null
  websiteUrl: string | null
  documentationUrl: string | null
  contactUrl: string | null
  supportSiteUrl: string | null
  termsOfServiceUrl: string | null

  // Content
  overview: string | null
  contentOverview: string | null
  contentHowItWorks: string | null
  contentConfigure: string | null

  // Permissions
  scopes: string[]

  // OAuth
  hasOauth: boolean
  oauthExternalEntrypointUrl: string | null

  // Publication status flags
  isDevelopment: boolean
  isPublished: boolean

  // Installation status for this organization
  isInstalled: boolean
  installationType?: 'development' | 'production'
  installedVersionId?: string

  // Developer account
  developerAccount: {
    title: string
    logoUrl: string | null
  }

  // Version info
  latestVersion?: {
    id: string
    versionString: string
    status: string | null
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
 *
 * @param input - Organization ID and optional filters/pagination
 * @returns Result with available apps and total count
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
        versions: {
          where: (versions, { eq, and }) =>
            and(eq(versions.versionType, 'prod'), eq(versions.status, 'active')),
          orderBy: (versions, { desc }) => [
            desc(versions.major),
            desc(versions.minor),
            desc(versions.patch),
          ],
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
        versions: {
          where: (versions, { eq, and }) =>
            and(
              eq(versions.versionType, 'dev'),
              eq(versions.targetOrganizationId, organizationId),
              eq(versions.status, 'active')
            ),
          orderBy: (versions, { desc }) => [
            desc(versions.major),
            desc(versions.minor),
            desc(versions.patch),
          ],
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

  // Filter dev apps that have at least one version for this org
  const devApps = devAppsResult.value.filter((app) => app.versions.length > 0)

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
  // Key format: "appId:installationType" (e.g., "my-app:development")
  // This allows both dev and prod installations to coexist in the map
  const installationMap = new Map(
    installationsResult.value.map((inst) => [
      `${inst.appId}:${inst.installationType}`,
      {
        installationType: inst.installationType,
        installedVersionId: inst.currentVersionId,
      },
    ])
  )

  // Combine published and dev apps, deduplicating by app ID
  // Dev apps take priority over published apps (if an app has both)
  const appsMap = new Map<string, typeof publishedAppsResult.value[0]>()

  // Add published apps first
  for (const app of publishedAppsResult.value) {
    appsMap.set(app.id, app)
  }

  // Add/override with dev apps (they take priority)
  for (const app of devApps) {
    appsMap.set(app.id, app)
  }

  const allApps = Array.from(appsMap.values())

  // Format apps with installation status
  const formattedApps: AvailableApp[] = allApps.map((app) => {
    const latestVersion = app.versions[0]

    // Determine if this is showing a dev version or prod version
    const isDev = app.versions.some((v) => v.versionType === 'dev')

    // Look up installation matching the version type we're displaying
    // This ensures we show the correct installation status when both dev and prod are installed
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
      installedVersionId: installation?.installedVersionId ?? undefined,
      developerAccount: {
        title: app.developerAccount.title,
        logoUrl: app.developerAccount.logoUrl,
      },
      latestVersion: latestVersion
        ? {
            id: latestVersion.id,
            versionString: `${latestVersion.major}.${latestVersion.minor}.${latestVersion.patch}`,
            status: latestVersion.status,
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
