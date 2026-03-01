// packages/services/src/app-versions/update-deployment-status.ts

import { App, AppDeployment, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Valid developer-side status transitions:
 * - submit-for-review: active → pending-review
 * - withdraw: pending-review → withdrawn
 * - publish: approved → published
 * - deprecate: published → deprecated
 */
const VALID_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  'submit-for-review': { from: ['active'], to: 'pending-review' },
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

  if (!transition.from.includes(deployment.status)) {
    return err({
      code: 'INVALID_STATUS_TRANSITION',
      message: `Cannot ${action} deployment in status "${deployment.status}"`,
      deploymentId,
      currentStatus: deployment.status,
      allowedFrom: transition.from,
    })
  }

  const updateResult = await fromDatabase(
    database
      .update(AppDeployment)
      .set({ status: transition.to })
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

  // When publishing first deployment, update app-level publicationStatus
  if (action === 'publish' && app.publicationStatus !== 'published') {
    await fromDatabase(
      database
        .update(App)
        .set({ publicationStatus: 'published', updatedAt: new Date() })
        .where(eq(App.id, app.id)),
      'update-app-publication-status'
    )
  }

  return ok({ deployment: updated })
}
