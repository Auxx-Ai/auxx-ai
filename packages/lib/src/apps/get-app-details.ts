// packages/lib/src/apps/get-app-details.ts

import type { Database } from '@auxx/database'
import {
  type ConnectionDefinitionSummary,
  getAppConnectionDefinition,
} from '@auxx/services/app-connections'
import { getCachedAppBySlug } from '../cache/app-cache-helpers'

/**
 * Input parameters for getAppWithInstallationStatus
 */
export interface GetAppWithStatusInput {
  appSlug: string
  organizationId: string
  db: Database
}

/**
 * App details with installation status
 */
export interface AppWithStatusOutput {
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
    overview: string | null
    contentOverview: string | null
    contentHowItWorks: string | null
    contentConfigure: string | null
    scopes: string[]
    hasOauth: boolean
    hasBundle: boolean
    screenshots: string[]
    verified: boolean
    publicationStatus: string
  }
  developerAccount: {
    title: string
    logoUrl: string | null
  }
  installation: {
    id: string | undefined
    isInstalled: boolean
    installationType?: 'development' | 'production'
    installedAt?: Date
    currentDeploymentId?: string
    connectionDefinition?: ConnectionDefinitionSummary
  }
  availableDeployments: Array<{
    id: string
    version: string | null
    deploymentType: 'development' | 'production'
    status: string
    createdAt: Date
  }>
}

/**
 * Get detailed app information with installation status for an organization.
 * Uses the global app slug cache for app data, DB for org-scoped parts.
 */
export async function getAppWithInstallationStatus(
  input: GetAppWithStatusInput
): Promise<
  | { ok: true; value: AppWithStatusOutput }
  | { ok: false; error: { code: string; message: string; [key: string]: unknown } }
> {
  const { appSlug, organizationId, db } = input

  // Resolve app from cache
  const cachedApp = await getCachedAppBySlug(appSlug)

  if (!cachedApp) {
    return {
      ok: false,
      error: { code: 'APP_NOT_FOUND', message: `App "${appSlug}" not found`, appSlug },
    }
  }

  // Query deployments accessible to this org
  const deployments = await db.query.AppDeployment.findMany({
    where: (d, { or, and, eq }) =>
      and(
        eq(d.appId, cachedApp.id),
        or(
          and(eq(d.deploymentType, 'development'), eq(d.targetOrganizationId, organizationId)),
          and(eq(d.deploymentType, 'production'), eq(d.status, 'published'))
        )
      ),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  })

  // Query installation status
  const installation = await db.query.AppInstallation.findFirst({
    where: (inst, { and, eq, isNull }) =>
      and(
        eq(inst.organizationId, organizationId),
        eq(inst.appId, cachedApp.id),
        isNull(inst.uninstalledAt)
      ),
  })

  // Access check
  const hasDevDeployments = deployments.some(
    (d) => d.deploymentType === 'development' && d.targetOrganizationId === organizationId
  )
  const isPublished = cachedApp.publicationStatus === 'published'
  const hasActiveInstallation = !!installation

  if (!isPublished && !hasDevDeployments && !hasActiveInstallation) {
    return {
      ok: false,
      error: {
        code: 'APP_ACCESS_DENIED',
        message: `You do not have access to app "${appSlug}"`,
        appSlug,
        organizationId,
      },
    }
  }

  // Fetch developer account info for display
  const developerAccount = await db.query.DeveloperAccount.findFirst({
    where: (da, { eq }) => eq(da.id, cachedApp.developerAccountId),
    columns: { title: true, logoUrl: true },
  })

  // Fetch connection definition if app is installed
  let connectionDefinition: ConnectionDefinitionSummary | undefined
  if (installation) {
    const userConnDef = await getAppConnectionDefinition(cachedApp.id, false)
    if (userConnDef.isOk()) {
      connectionDefinition = userConnDef.value
    } else {
      const orgConnDef = await getAppConnectionDefinition(cachedApp.id, true)
      if (orgConnDef.isOk()) {
        connectionDefinition = orgConnDef.value
      }
    }
  }

  return {
    ok: true,
    value: {
      app: {
        id: cachedApp.id,
        slug: cachedApp.slug,
        title: cachedApp.title,
        description: cachedApp.description,
        avatarUrl: cachedApp.avatarUrl,
        category: cachedApp.category,
        websiteUrl: cachedApp.websiteUrl,
        documentationUrl: cachedApp.documentationUrl,
        supportSiteUrl: cachedApp.supportSiteUrl,
        overview: cachedApp.overview,
        contentOverview: cachedApp.contentOverview,
        contentHowItWorks: cachedApp.contentHowItWorks,
        contentConfigure: cachedApp.contentConfigure,
        scopes: cachedApp.scopes,
        hasOauth: cachedApp.hasOauth,
        hasBundle: cachedApp.hasBundle,
        screenshots: cachedApp.screenshots,
        verified: cachedApp.verified,
        publicationStatus: cachedApp.publicationStatus,
      },
      developerAccount: developerAccount
        ? { title: developerAccount.title, logoUrl: developerAccount.logoUrl }
        : { title: 'Unknown', logoUrl: null },
      installation: {
        id: installation?.id,
        isInstalled: !!installation,
        installationType: installation?.installationType as
          | 'development'
          | 'production'
          | undefined,
        installedAt: installation?.installedAt,
        currentDeploymentId: installation?.currentDeploymentId ?? undefined,
        connectionDefinition,
      },
      availableDeployments: deployments.map((d) => ({
        id: d.id,
        version: d.version,
        deploymentType: d.deploymentType as 'development' | 'production',
        status: d.status,
        createdAt: d.createdAt,
      })),
    },
  }
}
