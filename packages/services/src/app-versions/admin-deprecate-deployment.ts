// packages/services/src/app-versions/admin-deprecate-deployment.ts

import { AdminActionLog, App, AppDeployment, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Admin-only: Deprecate a published deployment
 * Status: published → deprecated
 */
export async function adminDeprecateDeployment(params: {
  deploymentId: string
  adminUserId: string
}) {
  const { deploymentId, adminUserId } = params

  const deploymentResult = await fromDatabase(
    database.query.AppDeployment.findFirst({
      where: (d, { eq }) => eq(d.id, deploymentId),
      with: { app: true },
    }),
    'get-deployment'
  )

  if (deploymentResult.isErr()) return deploymentResult

  const deploymentWithApp = deploymentResult.value
  if (!deploymentWithApp) {
    return err({ code: 'DEPLOYMENT_NOT_FOUND', message: 'Deployment not found', deploymentId })
  }

  const { app, ...deployment } = deploymentWithApp

  if (deployment.status !== 'published') {
    return err({
      code: 'DEPLOYMENT_INVALID_STATUS',
      message: 'Can only deprecate published deployments',
      deploymentId,
      currentStatus: deployment.status,
    })
  }

  const updateResult = await fromDatabase(
    database
      .update(AppDeployment)
      .set({ status: 'deprecated' })
      .where(eq(AppDeployment.id, deploymentId))
      .returning(),
    'deprecate-deployment'
  )

  if (updateResult.isErr()) return updateResult

  const [updated] = updateResult.value
  if (!updated) {
    return err({
      code: 'DEPLOYMENT_UPDATE_FAILED',
      message: 'Failed to deprecate deployment',
      deploymentId,
    })
  }

  // Update app-level publication status if no other published deployments
  const otherPublished = await fromDatabase(
    database.query.AppDeployment.findFirst({
      where: (d, { and, eq, ne }) =>
        and(eq(d.appId, app.id), eq(d.status, 'published'), ne(d.id, deploymentId)),
    }),
    'check-other-published'
  )

  if (otherPublished.isOk() && !otherPublished.value) {
    await fromDatabase(
      database
        .update(App)
        .set({ publicationStatus: 'unpublished', updatedAt: new Date() })
        .where(eq(App.id, app.id)),
      'update-app-status'
    )
  }

  // Log admin action
  await fromDatabase(
    database.insert(AdminActionLog).values({
      adminUserId,
      actionType: 'DEPRECATE_APP_DEPLOYMENT',
      targetType: 'APP_DEPLOYMENT',
      targetId: deploymentId,
      previousState: { status: deployment.status },
      newState: { status: 'deprecated' },
      details: {
        appId: app.id,
        appTitle: app.title,
        appSlug: app.slug,
        version: deployment.version,
      },
    }),
    'log-admin-action'
  )

  return ok({ deployment: updated })
}
