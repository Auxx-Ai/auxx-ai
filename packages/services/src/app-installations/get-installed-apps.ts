// apps/api/src/services/organizations/apps/get-installed-apps.ts

import { database } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { getAppConnectionDefinition } from '../app-connections'
import type { ConnectionDefinitionSummary } from '../app-connections'

/**
 * Input parameters for getInstalledApps
 */
export interface GetInstalledAppsInput {
  organizationId: string
  filters?: {
    installationType?: 'development' | 'production'
  }
}

/**
 * Installed app details
 */
export interface InstalledApp {
  // Installation details
  installationId: string
  installationType: 'development' | 'production'
  installedAt: Date

  // App details
  app: {
    id: string
    slug: string
    title: string
    description: string | null
    avatarUrl: string | null
    category: string | null
  }

  // Current version details
  currentVersion: {
    id: string
    versionString: string
    status: string
    releasedAt: Date | null
  } | null

  // Connection definition
  connectionDefinition?: ConnectionDefinitionSummary
}

/**
 * Success output for getInstalledApps
 */
export interface GetInstalledAppsOutput {
  installations: InstalledApp[]
}

/**
 * Get all installed apps for an organization
 *
 * @param input - Organization ID and optional filters
 * @returns Result with list of installed apps
 */
export async function getInstalledApps(input: GetInstalledAppsInput) {
  const { organizationId, filters } = input

  // Query active installations for this organization
  const installationsResult = await fromDatabase(
    database.query.AppInstallation.findMany({
      where: (installations, { eq, and, isNull }) => {
        const conditions = [
          eq(installations.organizationId, organizationId),
          isNull(installations.uninstalledAt),
        ]

        if (filters?.installationType) {
          conditions.push(eq(installations.installationType, filters.installationType))
        }

        return and(...conditions)
      },
      with: {
        app: true,
        currentVersion: true,
      },
      orderBy: (installations, { desc }) => desc(installations.installedAt),
    }),
    'get-installed-apps'
  )

  if (installationsResult.isErr()) {
    return installationsResult
  }

  // Format the results and fetch connection definitions
  const installations: InstalledApp[] = []

  for (const installation of installationsResult.value) {
    // Get connection definition for this app
    let connectionDefinition: ConnectionDefinitionSummary | undefined

    if (installation.currentVersion) {
      // Try user-scoped connection first
      const userConnDefResult = await getAppConnectionDefinition(
        installation.app.id,
        installation.currentVersion.major,
        false
      )

      if (userConnDefResult.isOk() && userConnDefResult.value) {
        connectionDefinition = userConnDefResult.value
      } else {
        // Try organization-scoped
        const organizationConnDefResult = await getAppConnectionDefinition(
          installation.app.id,
          installation.currentVersion.major,
          true
        )
        if (organizationConnDefResult.isOk() && organizationConnDefResult.value) {
          connectionDefinition = organizationConnDefResult.value
        }
      }
    }

    installations.push({
      installationId: installation.id,
      installationType: installation.installationType as 'development' | 'production',
      installedAt: installation.installedAt,
      app: {
        id: installation.app.id,
        slug: installation.app.slug,
        title: installation.app.title,
        description: installation.app.description,
        avatarUrl: installation.app.avatarUrl,
        category: installation.app.category,
      },
      currentVersion: installation.currentVersion
        ? {
            id: installation.currentVersion.id,
            versionString: `${installation.currentVersion.major}.${installation.currentVersion.minor}.${installation.currentVersion.patch}`,
            status: installation.currentVersion.status ?? '',
            releasedAt: installation.currentVersion.releasedAt,
          }
        : null,
      connectionDefinition,
    })
  }

  return ok({
    installations,
  })
}
