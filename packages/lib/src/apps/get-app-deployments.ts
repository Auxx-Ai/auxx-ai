// packages/lib/src/apps/get-app-deployments.ts

import type { Database } from '@auxx/database'
import { getCachedAppBySlug } from '../cache/app-cache-helpers'

/**
 * Input parameters for getAppDeployments
 */
export interface GetAppDeploymentsInput {
  appSlug: string
  organizationId: string
  db: Database
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
 * Get available deployments for an app.
 * Uses the global app slug cache for app lookup, DB for org-scoped deployment queries.
 */
export async function getAppDeployments(
  input: GetAppDeploymentsInput
): Promise<
  | { ok: true; value: GetAppDeploymentsOutput }
  | { ok: false; error: { code: string; message: string; [key: string]: unknown } }
> {
  const { appSlug, organizationId, db, filters } = input

  // Resolve app from cache
  const cachedApp = await getCachedAppBySlug(appSlug)

  if (!cachedApp) {
    return {
      ok: false,
      error: { code: 'APP_NOT_FOUND', message: `App "${appSlug}" not found`, appSlug },
    }
  }

  // Query deployments with access control
  const deployments = await db.query.AppDeployment.findMany({
    where: (d, { and, or, eq }) => {
      const conditions = [
        eq(d.appId, cachedApp.id),
        or(
          and(eq(d.deploymentType, 'development'), eq(d.targetOrganizationId, organizationId)),
          and(eq(d.deploymentType, 'production'), eq(d.status, 'published'))
        )!,
      ]

      if (filters?.deploymentType) {
        conditions.push(eq(d.deploymentType, filters.deploymentType))
      }
      if (filters?.status) {
        conditions.push(eq(d.status, filters.status))
      }

      return and(...conditions)
    },
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  })

  // Query current installation to identify installed deployment
  const currentInstallation = await db.query.AppInstallation.findFirst({
    where: (inst, { and, eq, isNull }) =>
      and(
        eq(inst.appId, cachedApp.id),
        eq(inst.organizationId, organizationId),
        isNull(inst.uninstalledAt)
      ),
  })

  const currentDeploymentId = currentInstallation?.currentDeploymentId

  return {
    ok: true,
    value: {
      app: {
        id: cachedApp.id,
        slug: cachedApp.slug,
        title: cachedApp.title,
      },
      deployments: deployments.map((d) => ({
        id: d.id,
        version: d.version,
        deploymentType: d.deploymentType as 'development' | 'production',
        status: d.status,
        releaseNotes: d.releaseNotes,
        createdAt: d.createdAt,
        isCurrentlyInstalled: d.id === currentDeploymentId,
      })),
    },
  }
}
