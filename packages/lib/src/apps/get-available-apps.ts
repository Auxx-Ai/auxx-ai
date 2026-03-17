// packages/lib/src/apps/get-available-apps.ts

import type { Database } from '@auxx/database'
import { getCachedPublishedApps } from '../cache/app-cache-helpers'

/**
 * Input parameters for getAvailableApps
 */
export interface GetAvailableAppsInput {
  organizationId: string
  db: Database
  filters?: {
    category?: string
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
  verified: boolean
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
 * Get all apps available to an organization (published marketplace apps + dev apps targeting this org).
 * Published apps come from the global cache; dev apps and installations are org-scoped DB queries.
 */
export async function getAvailableApps(
  input: GetAvailableAppsInput
): Promise<GetAvailableAppsOutput> {
  const { organizationId, db, filters, pagination } = input
  const limit = pagination?.limit ?? 20
  const offset = pagination?.offset ?? 0

  // 1. Published apps from global cache (was: expensive DB query with joins)
  let publishedApps = await getCachedPublishedApps()
  if (filters?.category) {
    publishedApps = publishedApps.filter((a) => a.category === filters.category)
  }
  if (filters?.searchQuery) {
    const q = filters.searchQuery.toLowerCase()
    publishedApps = publishedApps.filter(
      (a) => a.title.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
    )
  }

  // 2. Dev apps targeting this org (still DB — org-scoped)
  const allAppsWithDevDeployments = await db.query.App.findMany({
    with: {
      developerAccount: { columns: { title: true, logoUrl: true } },
      deployments: {
        where: (d, { eq, and }) =>
          and(
            eq(d.deploymentType, 'development'),
            eq(d.targetOrganizationId, organizationId),
            eq(d.status, 'active')
          ),
        orderBy: (d, { desc }) => [desc(d.createdAt)],
        limit: 1,
      },
    },
  })

  // Filter to only apps that have at least one dev deployment for this org
  const devApps = allAppsWithDevDeployments.filter((app) => app.deployments.length > 0)

  // 3. Active installations for this org (still DB — org-scoped)
  const installations = await db.query.AppInstallation.findMany({
    where: (inst, { eq, and, isNull }) =>
      and(eq(inst.organizationId, organizationId), isNull(inst.uninstalledAt)),
    with: {
      app: {
        with: {
          developerAccount: { columns: { title: true, logoUrl: true } },
          deployments: {
            orderBy: (d, { desc }) => [desc(d.createdAt)],
            limit: 1,
          },
        },
      },
    },
  })

  // Create installation lookup by appId + type
  const installationMap = new Map(
    installations.map((inst) => [
      `${inst.appId}:${inst.installationType}`,
      {
        installationType: inst.installationType,
        installedDeploymentId: inst.currentDeploymentId,
      },
    ])
  )

  // 4. Combine published apps, dev apps, and installed apps — deduplicate by app ID.
  // Published apps use cached shape, dev/installed apps use DB shape. We need a unified approach.

  // Track seen app IDs
  const seenIds = new Set<string>()
  const formattedApps: AvailableApp[] = []

  // Add published apps (from cache)
  for (const app of publishedApps) {
    seenIds.add(app.id)
    const installation =
      installationMap.get(`${app.id}:development`) ?? installationMap.get(`${app.id}:production`)

    formattedApps.push({
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
      scopes: app.scopes,
      hasOauth: app.hasOauth,
      oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
      verified: app.verified,
      isDevelopment: false,
      isPublished: true,
      isInstalled: !!installation,
      installationType: installation?.installationType as 'development' | 'production' | undefined,
      installedDeploymentId: installation?.installedDeploymentId ?? undefined,
      developerAccount: app.developerAccount,
      latestDeployment: app.latestDeployment ?? undefined,
    })
  }

  // Add dev apps (from DB, override published if same ID)
  for (const app of devApps) {
    const latestDeployment = app.deployments[0]
    const installation =
      installationMap.get(`${app.id}:development`) ?? installationMap.get(`${app.id}:production`)

    const formatted: AvailableApp = {
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
      scopes: (app.scopes as string[]) ?? [],
      hasOauth: app.hasOauth ?? false,
      oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
      verified: app.verified ?? false,
      isDevelopment: true,
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

    if (seenIds.has(app.id)) {
      // Dev apps override published — replace in the array
      const idx = formattedApps.findIndex((a) => a.id === app.id)
      if (idx >= 0) formattedApps[idx] = formatted
    } else {
      seenIds.add(app.id)
      formattedApps.push(formatted)
    }
  }

  // Add installed apps not already discovered
  for (const inst of installations) {
    if (seenIds.has(inst.appId)) continue
    const app = inst.app
    if (filters?.category && app.category !== filters.category) continue
    if (filters?.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      if (!app.title.toLowerCase().includes(q) && !app.description?.toLowerCase().includes(q))
        continue
    }

    const latestDeployment = app.deployments[0]
    const installation =
      installationMap.get(`${app.id}:development`) ?? installationMap.get(`${app.id}:production`)

    seenIds.add(app.id)
    formattedApps.push({
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
      scopes: (app.scopes as string[]) ?? [],
      hasOauth: app.hasOauth ?? false,
      oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
      verified: app.verified ?? false,
      isDevelopment: app.deployments.some((d) => d.deploymentType === 'development'),
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
    })
  }

  // Apply pagination
  const paginatedApps = formattedApps.slice(offset, offset + limit)

  return {
    apps: paginatedApps,
    total: formattedApps.length,
  }
}
