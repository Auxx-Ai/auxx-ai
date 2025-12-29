// packages/services/src/apps/install-app.ts

import { database, schema, type Transaction } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { eq, sql } from 'drizzle-orm'
// import type { AppError } from './errors'
import { fromDatabase } from '../shared/utils'
import type { InstallAppInput } from './schemas'

/**
 * Input parameters for installApp
 */
// export interface InstallAppInput {
//   appSlug: string
//   organizationId: string
//   installationType: 'development' | 'production'
//   versionId?: string
//   installedById: string
// }

/**
 * Installation result
 */
export interface InstallAppOutput {
  installation: {
    id: string
    appId: string
    organizationId: string
    installationType: 'development' | 'production'
    currentVersionId: string | null
    installedAt: Date
  }
  app: {
    id: string
    slug: string
    title: string
  }
  version: {
    id: string
    versionString: string
  } | null
}

/**
 * Install an app for an organization
 *
 * @param input - App installation parameters
 * @returns Result with installation details
 */
export async function installApp(input: InstallAppInput) {
  const { appSlug, organizationId, versionId, installedById } = input
  let { installationType } = input

  // Query app with versions
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, appSlug),
      with: {
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
        },
      },
    }),
    'get-app-for-install'
  )

  if (appResult.isErr()) {
    // Map database error to AppError
    return err({
      code: 'DATABASE_ERROR' as const,
      message: appResult.error.message,
      cause: appResult.error.cause,
    })
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

  // Determine which version to install
  let selectedVersion: (typeof app.versions)[0] | null = null

  if (versionId) {
    // Verify version exists and is accessible
    selectedVersion = app.versions.find((v) => v.id === versionId) ?? null

    if (!selectedVersion) {
      return err({
        code: 'VERSION_ACCESS_DENIED' as const,
        message: `Version ${versionId} not found or not accessible`,
        versionId,
        organizationId,
      })
    }

    // Infer installation type from version type if not provided
    if (!installationType) {
      installationType = selectedVersion.versionType === 'dev' ? 'development' : 'production'
    }

    // Validate installation type matches version type
    if (installationType === 'production' && selectedVersion.versionType === 'dev') {
      return err({
        code: 'INVALID_INSTALLATION_TYPE' as const,
        message: 'Cannot install development version as production',
        details: 'Development versions can only be installed as development installations',
      })
    }

    // Verify version is active
    if (selectedVersion.status !== 'active') {
      return err({
        code: 'INVALID_INSTALLATION_TYPE' as const,
        message: 'Cannot install version with status: ' + selectedVersion.status,
        details: 'Only active versions can be installed',
      })
    }
  } else {
    // If no version specified and no installation type, default to production
    if (!installationType) {
      installationType = 'production'
    }

    // Find latest active version based on installation type
    const targetVersionType = installationType === 'production' ? 'prod' : 'dev'
    selectedVersion =
      app.versions
        .filter((v) => v.versionType === targetVersionType && v.status === 'active')
        .sort((a, b) => {
          if (a.major !== b.major) return b.major - a.major
          if ((a.minor ?? 0) !== (b.minor ?? 0)) return (b.minor ?? 0) - (a.minor ?? 0)
          return (b.patch ?? 0) - (a.patch ?? 0)
        })[0] ?? null

    if (!selectedVersion) {
      return err({
        code: 'NO_VERSIONS_AVAILABLE' as const,
        message: `No active ${targetVersionType} versions available for app "${appSlug}"`,
        appId: app.id,
        versionType: targetVersionType,
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
    // Map database error to AppError
    return err({
      code: 'DATABASE_ERROR' as const,
      message: existingInstallationResult.error.message,
      cause: existingInstallationResult.error.cause,
    })
  }

  const existingInstallation = existingInstallationResult.value

  // If already installed, return existing installation
  if (existingInstallation) {
    return err({
      code: 'APP_ALREADY_INSTALLED' as const,
      message: `App "${appSlug}" is already installed as ${installationType}`,
      appSlug,
      organizationId,
      installationType,
    })
  }

  // Create installation in a transaction
  const transactionResult = await fromDatabase(
    database.transaction(async (tx: Transaction) => {
      // Delete any old uninstalled records to avoid unique constraint violation
      // The unique index doesn't consider uninstalledAt, so we need to clean up
      await tx.delete(schema.AppInstallation).where(
        sql`${schema.AppInstallation.appId} = ${app.id}
              AND ${schema.AppInstallation.organizationId} = ${organizationId}
              AND ${schema.AppInstallation.installationType} = ${installationType}
              AND ${schema.AppInstallation.uninstalledAt} IS NOT NULL`
      )

      // Create installation
      const [installation] = await tx
        .insert(schema.AppInstallation)
        .values({
          appId: app.id,
          organizationId,
          installationType,
          currentVersionId: selectedVersion!.id,
          installedAt: new Date(),
        })
        .returning()

      if (!installation) {
        throw new Error('Failed to create installation')
      }

      // If production install, increment version's installation counter
      if (installationType === 'production' && selectedVersion) {
        await tx
          .update(schema.AppVersion)
          .set({ numInstallations: sql`${schema.AppVersion.numInstallations} + 1` })
          .where(eq(schema.AppVersion.id, selectedVersion.id))
      }

      // Log event
      await tx.insert(schema.AppEventLog).values({
        appId: app.id,
        organizationId: organizationId,
        appVersionId: selectedVersion!.id,
        userId: installedById,
        eventType: 'app.installed',
        eventData: {
          installationType,
          versionId: selectedVersion!.id,
          versionString: `${selectedVersion!.major}.${selectedVersion!.minor}.${selectedVersion!.patch}`,
        },
      })

      return { installation, version: selectedVersion }
    }),
    'install-app-transaction'
  )

  if (transactionResult.isErr()) {
    // Map database error to AppError
    return err({
      code: 'DATABASE_ERROR' as const,
      message: transactionResult.error.message,
      cause: transactionResult.error.cause,
    })
  }

  const { installation, version } = transactionResult.value

  return ok({
    installation: {
      id: installation.id,
      appId: installation.appId,
      organizationId: installation.organizationId,
      installationType: installation.installationType as 'development' | 'production',
      currentVersionId: installation.currentVersionId,
      installedAt: installation.installedAt,
    },
    app: {
      id: app.id,
      slug: app.slug,
      title: app.title,
    },
    version: version
      ? {
          id: version.id,
          versionString: `${version.major}.${version.minor ?? 0}.${version.patch ?? 0}`,
        }
      : null,
  })
}
