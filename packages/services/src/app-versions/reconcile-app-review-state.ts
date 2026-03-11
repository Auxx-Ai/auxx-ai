// packages/services/src/app-versions/reconcile-app-review-state.ts

import { App, database } from '@auxx/database'
import { and, eq, ne, or } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** Review statuses that represent an app currently being reviewed */
const ACTIVE_REVIEW_STATUSES = ['pending-review', 'in-review'] as const

/** Reviewable settled statuses that summarize the latest completed review outcome */
const SETTLED_REVIEW_STATUSES = [
  'approved',
  'published',
  'deprecated',
  'rejected',
  'withdrawn',
] as const

/**
 * Recalculate app-level publication and review state from production deployments.
 * Only one production deployment may be in review at a time.
 */
export async function reconcileAppReviewState(params: { appId: string }) {
  const { appId } = params

  const deploymentsResult = await fromDatabase(
    database.query.AppDeployment.findMany({
      where: (deployments, { and, eq }) =>
        and(eq(deployments.appId, appId), eq(deployments.deploymentType, 'production')),
      orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
    }),
    'list-production-deployments-for-reconciliation'
  )

  if (deploymentsResult.isErr()) return deploymentsResult

  const deployments = deploymentsResult.value
  const activeReviewDeployments = deployments.filter((deployment) =>
    ACTIVE_REVIEW_STATUSES.includes(deployment.status as (typeof ACTIVE_REVIEW_STATUSES)[number])
  )

  if (activeReviewDeployments.length > 1) {
    return err({
      code: 'MULTIPLE_DEPLOYMENTS_IN_REVIEW',
      message: 'Only one production deployment can be in review at a time',
      appId,
      deploymentIds: activeReviewDeployments.map((deployment) => deployment.id),
    })
  }

  /** Summary publication status derived from published production deployments */
  const publicationStatus = deployments.some((deployment) => deployment.status === 'published')
    ? 'published'
    : 'unpublished'

  /** Summary review status derived from the active review deployment or latest settled deployment */
  const reviewStatus =
    activeReviewDeployments[0]?.status ??
    normalizeSettledReviewStatus(
      deployments.find((deployment) =>
        SETTLED_REVIEW_STATUSES.includes(
          deployment.status as (typeof SETTLED_REVIEW_STATUSES)[number]
        )
      )?.status ?? null
    )

  const updateResult = await fromDatabase(
    database
      .update(App)
      .set({ publicationStatus, reviewStatus, updatedAt: new Date() })
      .where(eq(App.id, appId))
      .returning(),
    'update-app-state-from-deployments'
  )

  if (updateResult.isErr()) return updateResult

  const [app] = updateResult.value
  if (!app) {
    return err({ code: 'APP_UPDATE_FAILED', message: 'Failed to reconcile app state', appId })
  }

  return ok({ app })
}

/**
 * Find the production deployment currently in review for an app, excluding an optional deployment id.
 */
export async function findActiveReviewDeployment(params: {
  appId: string
  excludeDeploymentId?: string
}) {
  const { appId, excludeDeploymentId } = params

  const deploymentsResult = await fromDatabase(
    database.query.AppDeployment.findMany({
      where: (deployments) => {
        const filters = [
          eq(deployments.appId, appId),
          eq(deployments.deploymentType, 'production'),
          or(eq(deployments.status, 'pending-review'), eq(deployments.status, 'in-review'))!,
        ]

        if (excludeDeploymentId) {
          filters.push(ne(deployments.id, excludeDeploymentId))
        }

        return and(...filters)
      },
      orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
      limit: 2,
    }),
    'find-active-review-deployments'
  )

  if (deploymentsResult.isErr()) return deploymentsResult

  return ok({ deployments: deploymentsResult.value })
}

/**
 * Normalize deployment lifecycle statuses into the app-level review status vocabulary.
 */
function normalizeSettledReviewStatus(status: string | null): string | null {
  if (!status) return null

  if (status === 'approved' || status === 'published' || status === 'deprecated') {
    return 'approved'
  }

  if (status === 'rejected' || status === 'withdrawn') {
    return status
  }

  return null
}
