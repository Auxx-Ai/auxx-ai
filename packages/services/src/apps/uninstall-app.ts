// packages/services/src/apps/uninstall-app.ts

import { database, schema, type Transaction } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
// import type { AppError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for uninstallApp
 */
export interface UninstallAppInput {
  appSlug: string
  organizationId: string
  uninstalledById: string
  installationType?: 'development' | 'production'
}

/**
 * Uninstall result
 */
export interface UninstallAppOutput {
  success: true
  uninstalledAt: Date
  app: {
    slug: string
    title: string
  }
  installationType: 'development' | 'production'
}

/**
 * Uninstall an app from an organization
 *
 * @param input - App uninstall parameters
 * @returns Result with uninstall confirmation
 */
export async function uninstallApp(input: UninstallAppInput) {
  const { appSlug, organizationId, uninstalledById, installationType } = input

  // Find app
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, appSlug),
    }),
    'get-app-for-uninstall'
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

  // Find active installation
  const installationResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (installations, { and, eq, isNull }) => {
        const conditions = [
          eq(installations.appId, app.id),
          eq(installations.organizationId, organizationId),
          isNull(installations.uninstalledAt),
        ]

        // If installationType specified, match it
        if (installationType) {
          conditions.push(eq(installations.installationType, installationType))
        }

        return and(...conditions)
      },
    }),
    'get-active-installation'
  )

  if (installationResult.isErr()) {
    return installationResult
  }

  const installation = installationResult.value

  if (!installation) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: installationType
        ? `App "${appSlug}" is not installed as ${installationType}`
        : `App "${appSlug}" is not installed`,
      appSlug,
    })
  }

  // Uninstall in a transaction
  const now = new Date()

  const transactionResult = await fromDatabase(
    database.transaction(async (tx: Transaction) => {
      // Delete app settings
      await tx
        .delete(schema.AppSetting)
        .where(eq(schema.AppSetting.appInstallationId, installation.id))

      // Delete app connections
      await tx
        .delete(schema.WorkflowCredentials)
        .where(eq(schema.WorkflowCredentials.appInstallationId, installation.id))

      // Soft delete installation
      const [updated] = await tx
        .update(schema.AppInstallation)
        .set({ uninstalledAt: now, updatedAt: now })
        .where(eq(schema.AppInstallation.id, installation.id))
        .returning()

      if (!updated) {
        throw new Error('Failed to uninstall app')
      }

      // If production install, decrement version's installation counter
      if (updated.installationType === 'production' && updated.currentVersionId) {
        await tx
          .update(schema.AppVersion)
          .set({
            numInstallations: sql`GREATEST(0, ${schema.AppVersion.numInstallations} - 1)`,
          })
          .where(eq(schema.AppVersion.id, updated.currentVersionId))
      }

      // Log event
      await tx.insert(schema.AppEventLog).values({
        appId: app.id,
        organizationId: organizationId,
        appVersionId: updated.currentVersionId,
        userId: uninstalledById,
        eventType: 'app.uninstalled',
        eventData: {
          installationType: updated.installationType,
        },
      })

      return updated
    }),
    'uninstall-app-transaction'
  )

  if (transactionResult.isErr()) {
    return transactionResult
  }

  const uninstalledInstallation = transactionResult.value

  return ok({
    success: true,
    uninstalledAt: now,
    app: {
      slug: app.slug,
      title: app.title,
    },
    installationType: uninstalledInstallation.installationType as 'development' | 'production',
  })
}
