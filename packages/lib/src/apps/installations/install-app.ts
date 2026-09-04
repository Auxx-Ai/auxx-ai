// packages/lib/src/apps/installations/install-app.ts

import { type CatalogPayload, database, schema, type Transaction } from '@auxx/database'
import type { InstallAppInput } from '@auxx/services/apps'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq, isNotNull } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { onCacheEvent } from '../../cache/invalidate'
import { reconnectConnectorsForInstallation } from '../../data-connectors/mutations'
import { applyInstallationCatalog } from './app-field-provisioning'

/**
 * Installation result
 */
export interface InstallAppOutput {
  installation: {
    id: string
    appId: string
    organizationId: string
    installationType: 'development' | 'production'
    currentDeploymentId: string | null
    installedAt: Date
  }
  app: {
    id: string
    slug: string
    title: string
  }
  deployment: {
    id: string
    version: string | null
  } | null
}

/**
 * Install an app for an organization
 *
 * @param input - App installation parameters
 * @returns Result with installation details
 */
export async function installApp(input: InstallAppInput) {
  const { appId, organizationId, deploymentId, installedById } = input
  let { installationType } = input

  // Query app with deployments
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
      with: {
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
        },
      },
    }),
    'get-app-for-install'
  )

  if (appResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR' as const,
      message: appResult.error.message,
      cause: appResult.error.cause,
    })
  }

  const app = appResult.value

  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: `App "${appId}" not found`,
      appId,
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
      message: `You do not have access to app "${app.slug}"`,
      appId,
      organizationId,
    })
  }

  // Determine which deployment to install
  let selectedDeployment: (typeof app.deployments)[0] | null = null

  if (deploymentId) {
    // Verify deployment exists and is accessible
    selectedDeployment = app.deployments.find((d) => d.id === deploymentId) ?? null

    if (!selectedDeployment) {
      return err({
        code: 'DEPLOYMENT_ACCESS_DENIED' as const,
        message: `Deployment ${deploymentId} not found or not accessible`,
        deploymentId,
        organizationId,
      })
    }

    // Infer installation type from deployment type if not provided
    if (!installationType) {
      installationType = selectedDeployment.deploymentType as 'development' | 'production'
    }

    // Validate installation type matches deployment type
    if (installationType === 'production' && selectedDeployment.deploymentType === 'development') {
      return err({
        code: 'INVALID_INSTALLATION_TYPE' as const,
        message: 'Cannot install development deployment as production',
        details: 'Development deployments can only be installed as development installations',
      })
    }

    // Verify deployment is installable
    const installableStatuses =
      selectedDeployment.deploymentType === 'development' ? ['active'] : ['published']
    if (!installableStatuses.includes(selectedDeployment.status)) {
      return err({
        code: 'INVALID_INSTALLATION_TYPE' as const,
        message: `Cannot install deployment with status: ${selectedDeployment.status}`,
        details: 'Only active (dev) or published (prod) deployments can be installed',
      })
    }
  } else {
    // If no deployment specified and no installation type, default to production
    if (!installationType) {
      installationType = 'production'
    }

    // Find latest installable deployment based on installation type
    const targetType = installationType === 'production' ? 'production' : 'development'
    const targetStatus = installationType === 'production' ? 'published' : 'active'

    selectedDeployment =
      app.deployments
        .filter((d) => d.deploymentType === targetType && d.status === targetStatus)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null

    if (!selectedDeployment) {
      return err({
        code: 'NO_DEPLOYMENTS_AVAILABLE' as const,
        message: `No installable ${targetType} deployments available for app "${app.slug}"`,
        appId: app.id,
        deploymentType: targetType,
      })
    }
  }

  // Check if already installed
  const existingInstallationResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (installations, { and, eq, isNull }) =>
        and(
          eq(installations.appId, app.id),
          eq(installations.organizationId, organizationId),
          eq(installations.installationType, installationType),
          isNull(installations.uninstalledAt)
        ),
    }),
    'check-existing-installation'
  )

  if (existingInstallationResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR' as const,
      message: existingInstallationResult.error.message,
      cause: existingInstallationResult.error.cause,
    })
  }

  const existingInstallation = existingInstallationResult.value

  if (existingInstallation) {
    return err({
      code: 'APP_ALREADY_INSTALLED' as const,
      message: `App "${app.slug}" is already installed as ${installationType}`,
      appId,
      organizationId,
      installationType,
    })
  }

  // Create installation in a transaction
  const transactionResult = await fromDatabase(
    database.transaction(async (tx: Transaction) => {
      // Reactivate soft-deleted installation if one exists (preserves stable installationId
      // so workflow nodes, webhook handlers, and credentials remain valid across reinstall)
      const softDeleted = await tx.query.AppInstallation.findFirst({
        where: and(
          eq(schema.AppInstallation.appId, app.id),
          eq(schema.AppInstallation.organizationId, organizationId),
          eq(schema.AppInstallation.installationType, installationType!),
          isNotNull(schema.AppInstallation.uninstalledAt)
        ),
      })

      let installation: NonNullable<typeof softDeleted>

      if (softDeleted) {
        // Reactivate — same ID persists
        const [reactivated] = await tx
          .update(schema.AppInstallation)
          .set({
            uninstalledAt: null,
            currentDeploymentId: selectedDeployment!.id,
            installedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.AppInstallation.id, softDeleted.id))
          .returning()

        if (!reactivated) {
          throw new Error('Failed to reactivate installation')
        }
        installation = reactivated
        // Bring back the connectors uninstall disconnected (plans/money/tasks/44 D-1b).
        // `'paused'`, never `'live'`: reinstalling an app is not consent to start a
        // sync, and the first run after a gap is the one most likely to be large.
        // Not left `'disconnected'` either — that status means "the app is gone" and
        // the detail view disables its resume toggle on exactly that basis, so leaving
        // it would strand the connector with no way back.
        await reconnectConnectorsForInstallation(tx, organizationId, installation.id)
      } else {
        // Create new installation
        const [created] = await tx
          .insert(schema.AppInstallation)
          .values({
            appId: app.id,
            organizationId,
            installationType,
            currentDeploymentId: selectedDeployment!.id,
            installedAt: new Date(),
          })
          .returning()

        if (!created) {
          throw new Error('Failed to create installation')
        }
        installation = created
      }

      // Reconcile the app's custom fields against the catalog (installation- AND
      // connection-scoped, for any existing org-scoped connections a reactivated
      // installation kept). Best-effort warm-up — the authoritative reconcile runs
      // at connector sync setup, which parks visibly on any error.
      await applyInstallationCatalog(
        {
          appInstallationId: installation.id,
          organizationId,
          appSlug: app.slug,
          catalog: selectedDeployment!.catalog as CatalogPayload | null,
        },
        tx
      )

      // Log event
      await tx.insert(schema.AppEventLog).values({
        appId: app.id,
        organizationId,
        appDeploymentId: selectedDeployment!.id,
        userId: installedById,
        eventType: 'app.installed',
        eventData: {
          installationType,
          deploymentId: selectedDeployment!.id,
          version: selectedDeployment!.version,
        },
      })

      return { installation, deployment: selectedDeployment }
    }),
    'install-app-transaction'
  )

  if (transactionResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR' as const,
      message: transactionResult.error.message,
      cause: transactionResult.error.cause,
    })
  }

  const { installation, deployment } = transactionResult.value

  // Bust the customFields org cache AFTER commit so the warm-up's provisioned
  // fields are resolvable immediately (busting mid-tx would let a concurrent read
  // refill the cache from pre-commit rows).
  await onCacheEvent('custom-field.created', { orgId: organizationId })

  return ok({
    installation: {
      id: installation.id,
      appId: installation.appId,
      organizationId: installation.organizationId,
      installationType: installation.installationType as 'development' | 'production',
      currentDeploymentId: installation.currentDeploymentId,
      installedAt: installation.installedAt,
    },
    app: {
      id: app.id,
      slug: app.slug,
      title: app.title,
    },
    deployment: deployment
      ? {
          id: deployment.id,
          version: deployment.version,
        }
      : null,
  })
}
