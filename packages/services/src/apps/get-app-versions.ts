// apps/api/src/services/organizations/apps/get-app-versions.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
// import type { AppError } from './errors'
// import type { AppVersionError } from '../app-versions/errors'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for getAppVersions
 */
export interface GetAppVersionsInput {
  appSlug: string
  organizationId: string
  filters?: {
    versionType?: 'dev' | 'prod'
    status?: 'draft' | 'active' | 'deprecated'
  }
}

/**
 * App version details
 */
export interface AppVersionDetail {
  id: string
  versionString: string
  versionType: 'dev' | 'prod'
  status: 'draft' | 'active' | 'deprecated'
  releaseNotes: string | null
  releasedAt: Date | null
  createdAt: Date
  isCurrentlyInstalled: boolean
}

/**
 * Success output for getAppVersions
 */
export interface GetAppVersionsOutput {
  app: {
    id: string
    slug: string
    title: string
  }
  versions: AppVersionDetail[]
}

/**
 * Get available versions for an app
 *
 * @param input - App slug, organization ID, and optional filters
 * @returns Result with app info and list of available versions
 */
export async function getAppVersions(input: GetAppVersionsInput) {
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

  // Query versions with access control
  const versionsResult = await fromDatabase(
    database.query.AppVersion.findMany({
      where: (versions, { and, or, eq }) => {
        const conditions = [
          eq(versions.appId, app.id),
          or(
            // Dev versions for this org
            and(eq(versions.versionType, 'dev'), eq(versions.targetOrganizationId, organizationId)),
            // Published prod versions
            and(eq(versions.versionType, 'prod'), eq(versions.publicationStatus, 'published'))
          )!,
        ]

        // Apply optional filters
        if (filters?.versionType) {
          conditions.push(eq(versions.versionType, filters.versionType))
        }

        if (filters?.status) {
          conditions.push(eq(versions.status, filters.status))
        }

        return and(...conditions)
      },
      orderBy: (versions, { desc }) => [
        desc(versions.major),
        desc(versions.minor),
        desc(versions.patch),
      ],
    }),
    'get-app-versions'
  )

  if (versionsResult.isErr()) {
    return versionsResult
  }

  // Query current installation to identify installed version
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
  const currentVersionId = currentInstallation?.currentVersionId

  // Format versions
  const versions: AppVersionDetail[] = versionsResult.value.map((version) => ({
    id: version.id,
    versionString: `${version.major}.${version.minor}.${version.patch}`,
    versionType: version.versionType as 'dev' | 'prod',
    status: version.status as 'draft' | 'active' | 'deprecated',
    releaseNotes: version.releaseNotes,
    releasedAt: version.releasedAt,
    createdAt: version.createdAt,
    isCurrentlyInstalled: version.id === currentVersionId,
  }))

  return ok({
    app: {
      id: app.id,
      slug: app.slug,
      title: app.title,
    },
    versions,
  })
}
