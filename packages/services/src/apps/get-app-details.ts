// apps/api/src/services/organizations/apps/get-app-with-status.ts

import { database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
// import type { AppError } from './errors'
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
    currentVersionId?: string
  }

  // Available versions
  availableVersions: Array<{
    id: string
    versionString: string
    versionType: 'dev' | 'prod'
    status: string
    releasedAt: Date | null
  }>
}

/**
 * Get detailed app information with installation status for an organization
 *
 * @param input - App slug and organization ID
 * @returns Result with app details, installation status, and available versions
 */
export async function getAppWithInstallationStatus(input: GetAppWithStatusInput) {
  const { appSlug, organizationId } = input

  // Query app with versions and developer account
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, appSlug),
      with: {
        developerAccount: true,
        versions: {
          where: (versions, { or, and, eq }) =>
            or(
              // Dev versions for this org
              and(
                eq(versions.versionType, 'dev'),
                eq(versions.targetOrganizationId, organizationId)
              ),
              // Published prod versions
              and(eq(versions.versionType, 'prod'), eq(versions.publicationStatus, 'published'))
            ),
          orderBy: (versions, { desc }) => [
            desc(versions.major),
            desc(versions.minor),
            desc(versions.patch),
          ],
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
  const hasDevVersions = app.versions.some(
    (v) => v.versionType === 'dev' && v.targetOrganizationId === organizationId
  )
  const isPublished = app.publicationStatus === 'published'

  if (!isPublished && !hasDevVersions) {
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
      currentVersionId: installation?.currentVersionId ?? undefined,
    },
    availableVersions: app.versions.map((version) => ({
      id: version.id,
      versionString: `${version.major}.${version.minor}.${version.patch}`,
      versionType: version.versionType as 'dev' | 'prod',
      status: version.status,
      releasedAt: version.releasedAt,
    })),
  })
}
