// packages/services/src/app-versions/update-deployment-status.ts

import { AppDeployment, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { findActiveReviewDeployment, reconcileAppReviewState } from './reconcile-app-review-state'

/**
 * Valid developer-side status transitions:
 * - submit-for-review: active|withdrawn|rejected → pending-review
 * - withdraw: pending-review → withdrawn
 * - publish: approved → published
 * - deprecate: published → deprecated
 */
const VALID_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  'submit-for-review': { from: ['active', 'withdrawn', 'rejected'], to: 'pending-review' },
  withdraw: { from: ['pending-review'], to: 'withdrawn' },
  publish: { from: ['approved'], to: 'published' },
  deprecate: { from: ['published'], to: 'deprecated' },
}

/**
 * Developer-side deployment status transitions.
 * For admin-side transitions (approve, reject), use the admin-* services.
 */
export async function updateDeploymentStatus(params: {
  deploymentId: string
  action: 'submit-for-review' | 'withdraw' | 'publish' | 'deprecate'
  userId: string
}) {
  const { deploymentId, action, userId } = params

  const transition = VALID_TRANSITIONS[action]
  if (!transition) {
    return err({ code: 'INVALID_ACTION', message: `Unknown action: ${action}` })
  }

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

  const memberResult = await fromDatabase(
    database.query.DeveloperAccountMember.findFirst({
      where: (members, { and, eq }) =>
        and(eq(members.developerAccountId, app.developerAccountId), eq(members.userId, userId)),
    }),
    'check-developer-access'
  )

  if (memberResult.isErr()) return memberResult

  if (!memberResult.value) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED',
      message: 'You do not have permission to update this deployment',
      deploymentId,
      userId,
    })
  }

  if (!transition.from.includes(deployment.status)) {
    return err({
      code: 'INVALID_STATUS_TRANSITION',
      message: `Cannot ${action} deployment in status "${deployment.status}"`,
      deploymentId,
      currentStatus: deployment.status,
      allowedFrom: transition.from,
    })
  }

  if (action === 'submit-for-review') {
    const activeReviewResult = await findActiveReviewDeployment({
      appId: app.id,
      excludeDeploymentId: deploymentId,
    })

    if (activeReviewResult.isErr()) return activeReviewResult

    const [activeReviewDeployment] = activeReviewResult.value.deployments
    if (activeReviewDeployment) {
      return err({
        code: 'APP_REVIEW_ALREADY_IN_PROGRESS',
        message: 'Another production deployment is already in review for this app',
        deploymentId,
        appId: app.id,
        activeReviewDeploymentId: activeReviewDeployment.id,
      })
    }
  }

  // If the app has autoApprove enabled, skip review and go straight to approved
  const targetStatus =
    action === 'submit-for-review' && app.autoApprove ? 'approved' : transition.to

  const updateResult = await fromDatabase(
    database
      .update(AppDeployment)
      .set({ status: targetStatus })
      .where(eq(AppDeployment.id, deploymentId))
      .returning(),
    'update-deployment-status'
  )

  if (updateResult.isErr()) return updateResult

  const [updated] = updateResult.value
  if (!updated) {
    return err({
      code: 'DEPLOYMENT_UPDATE_FAILED',
      message: `Failed to ${action} deployment`,
      deploymentId,
    })
  }

  const reconcileResult = await reconcileAppReviewState({ appId: app.id })
  if (reconcileResult.isErr()) return reconcileResult

  const autoApproved = action === 'submit-for-review' && app.autoApprove === true
  return ok({ deployment: updated, autoApproved })
}
