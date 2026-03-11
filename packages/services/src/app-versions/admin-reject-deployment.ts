// packages/services/src/app-versions/admin-reject-deployment.ts

import { AdminActionLog, AppDeployment, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { reconcileAppReviewState } from './reconcile-app-review-state'

/**
 * Admin-only: Reject deployment in review
 * Status: pending-review/in-review → rejected
 */
export async function adminRejectDeployment(params: {
  deploymentId: string
  reason: string
  adminUserId: string
}) {
  const { deploymentId, reason, adminUserId } = params

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
      message: 'Deployment must be pending review or in review to reject',
      deploymentId,
      currentStatus: deployment.status,
    })
  }

  const updateResult = await fromDatabase(
    database
      .update(AppDeployment)
      .set({
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
        rejectionReason: reason,
      })
      .where(eq(AppDeployment.id, deploymentId))
      .returning(),
    'reject-deployment'
  )

  if (updateResult.isErr()) return updateResult

  const [updated] = updateResult.value
  if (!updated) {
    return err({
      code: 'DEPLOYMENT_UPDATE_FAILED',
      message: 'Failed to reject deployment',
      deploymentId,
    })
  }

  const reconcileResult = await reconcileAppReviewState({ appId: app.id })
  if (reconcileResult.isErr()) return reconcileResult

  // Log admin action
  await fromDatabase(
    database.insert(AdminActionLog).values({
      adminUserId,
      actionType: 'REJECT_APP_DEPLOYMENT',
      targetType: 'APP_DEPLOYMENT',
      targetId: deploymentId,
      reason,
      previousState: { status: deployment.status },
      newState: { status: 'rejected' },
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
