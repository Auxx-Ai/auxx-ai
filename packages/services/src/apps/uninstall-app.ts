// packages/services/src/apps/uninstall-app.ts

import { database, schema, type Transaction } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for uninstallApp
 */
export interface UninstallAppInput {
  appId: string
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
  const { appId, organizationId, uninstalledById, installationType } = input

  // Find app
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
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
      message: `App "${appId}" not found`,
      appId,
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
        ? `App "${app.slug}" is not installed as ${installationType}`
        : `App "${app.slug}" is not installed`,
      appId,
    })
  }

  // Uninstall in a transaction
  const now = new Date()

  const transactionResult = await fromDatabase(
    database.transaction(async (tx: Transaction) => {
      // Preserve AppSettings and WorkflowCredentials on uninstall so they survive
      // reinstall (Approach A: stable installation identity). OAuth tokens may expire
      // but refresh logic or re-auth flow handles that without destroying the row.

      // Soft delete installation
      const [updated] = await tx
        .update(schema.AppInstallation)
        .set({ uninstalledAt: now, updatedAt: now })
        .where(eq(schema.AppInstallation.id, installation.id))
        .returning()

      if (!updated) {
        throw new Error('Failed to uninstall app')
      }

      // Log event
      await tx.insert(schema.AppEventLog).values({
        appId: app.id,
        organizationId: organizationId,
        appDeploymentId: updated.currentDeploymentId,
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
