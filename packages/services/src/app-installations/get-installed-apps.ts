// packages/services/src/app-installations/get-installed-apps.ts

import { database } from '@auxx/database'
import { ok } from 'neverthrow'
import type { ConnectionDefinitionSummary, ConnectionMethod } from '../app-connections'
import { getAppConnectionDefinition, listAppConnectionDefinitions } from '../app-connections'
import { fromDatabase } from '../shared/utils'

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

  // Current deployment details
  currentDeployment: {
    id: string
    version: string | null
    deploymentType: string
    status: string
    clientBundleSha: string
    createdAt: Date
  } | null

  // Every connection method the app exposes (one per ConnectionDefinition row). The
  // authoritative axis for connecting — the connect picker appears when length > 1.
  methods: ConnectionMethod[]

  // Connection definitions, split by scope — a derived convenience view kept for the many
  // presence/scope consumers. With >1 method in a scope it shows only the first; use `methods`
  // when method identity matters (the picker, save).
  connectionDefinitions: {
    user?: ConnectionDefinitionSummary
    organization?: ConnectionDefinitionSummary
  }
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
        currentDeployment: {
          with: {
            clientBundle: true,
          },
        },
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
    const [userConnDefResult, orgConnDefResult, methodsResult] = await Promise.all([
      getAppConnectionDefinition(installation.app.id, false),
      getAppConnectionDefinition(installation.app.id, true),
      listAppConnectionDefinitions(installation.app.id),
    ])

    const methods: ConnectionMethod[] = methodsResult.isOk() ? methodsResult.value : []
    const connectionDefinitions: InstalledApp['connectionDefinitions'] = {
      user: userConnDefResult.isOk() ? (userConnDefResult.value ?? undefined) : undefined,
      organization: orgConnDefResult.isOk() ? (orgConnDefResult.value ?? undefined) : undefined,
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
      currentDeployment: installation.currentDeployment
        ? {
            id: installation.currentDeployment.id,
            version: installation.currentDeployment.version,
            deploymentType: installation.currentDeployment.deploymentType,
            status: installation.currentDeployment.status,
            clientBundleSha: installation.currentDeployment.clientBundle.sha256,
            createdAt: installation.currentDeployment.createdAt,
          }
        : null,
      methods,
      connectionDefinitions,
    })
  }

  return ok({
    installations,
  })
}
