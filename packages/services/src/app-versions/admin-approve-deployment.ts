// packages/services/src/app-versions/admin-approve-deployment.ts

import { AdminActionLog, App, AppDeployment, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Admin-only: Approve deployment in review
 * Status: pending-review/in-review → approved (or published if autoPublish)
 */
export async function adminApproveDeployment(params: {
  deploymentId: string
  adminUserId: string
  autoPublish?: boolean
}) {
  const { deploymentId, adminUserId, autoPublish = false } = params

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

  if (deployment.status !== 'pending-review' && deployment.status !== 'in-review') {
    return err({
      code: 'DEPLOYMENT_NOT_IN_REVIEW',
      message: 'Deployment must be pending review or in review to approve',
      deploymentId,
      currentStatus: deployment.status,
    })
  }

  const newStatus = autoPublish ? 'published' : 'approved'

  const updateResult = await fromDatabase(
    database
      .update(AppDeployment)
      .set({
        status: newStatus,
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      })
      .where(eq(AppDeployment.id, deploymentId))
      .returning(),
    'approve-deployment'
  )

  if (updateResult.isErr()) return updateResult

  const [updated] = updateResult.value
  if (!updated) {
    return err({
      code: 'DEPLOYMENT_UPDATE_FAILED',
      message: 'Failed to approve deployment',
      deploymentId,
    })
  }

  // Update app-level status
  if (autoPublish) {
    await fromDatabase(
      database
        .update(App)
        .set({ publicationStatus: 'published', reviewStatus: 'approved', updatedAt: new Date() })
        .where(eq(App.id, app.id)),
      'update-app-status'
    )
  } else {
    await fromDatabase(
      database
        .update(App)
        .set({ reviewStatus: 'approved', updatedAt: new Date() })
        .where(eq(App.id, app.id)),
      'update-app-status'
    )
  }

  // Log admin action
  await fromDatabase(
    database.insert(AdminActionLog).values({
      adminUserId,
      actionType: 'APPROVE_APP_DEPLOYMENT',
      targetType: 'APP_DEPLOYMENT',
      targetId: deploymentId,
      previousState: { status: deployment.status },
      newState: { status: newStatus },
      details: {
        appId: app.id,
        appTitle: app.title,
        appSlug: app.slug,
        version: deployment.version,
        autoPublish,
      },
    }),
    'log-admin-action'
  )

  return ok({ deployment: updated, published: autoPublish })
}
