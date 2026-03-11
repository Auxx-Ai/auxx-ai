// packages/services/src/app-versions/promote-to-production.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { calculateNextVersion } from './calculate-next-version'
import { reconcileAppReviewState } from './reconcile-app-review-state'

/**
 * Promote a development deployment to production.
 * Creates a new production AppDeployment row that references the same bundles.
 * The original dev deployment remains untouched.
 */
export async function promoteToProduction(params: {
  sourceDeploymentId: string
  userId: string
  version?: string
  releaseNotes?: string
}) {
  const { sourceDeploymentId, userId, version, releaseNotes } = params

  // Fetch the source deployment
  const sourceResult = await fromDatabase(
    database.query.AppDeployment.findFirst({
      where: eq(schema.AppDeployment.id, sourceDeploymentId),
    }),
    'find-source-deployment'
  )

  if (sourceResult.isErr()) return sourceResult

  const source = sourceResult.value
  if (!source) {
    return err({
      code: 'DEPLOYMENT_NOT_FOUND' as const,
      message: 'Source deployment not found',
    })
  }

  if (source.deploymentType !== 'development') {
    return err({
      code: 'INVALID_DEPLOYMENT_TYPE' as const,
      message: 'Only development deployments can be promoted to production',
    })
  }

  // Calculate version
  const resolvedVersion = version || (await calculateNextVersion(source.appId))

  // Create the production deployment
  const insertResult = await fromDatabase(
    database
      .insert(schema.AppDeployment)
      .values({
        appId: source.appId,
        deploymentType: 'production',
        clientBundleId: source.clientBundleId,
        serverBundleId: source.serverBundleId,
        settingsSchema: source.settingsSchema,
        targetOrganizationId: null,
        environmentVariables: null,
        version: resolvedVersion,
        status: 'active',
        releaseNotes: releaseNotes || null,
        metadata: source.metadata,
        createdById: userId,
      })
      .returning(),
    'insert-promoted-deployment'
  )

  if (insertResult.isErr()) return insertResult

  const [deployment] = insertResult.value
  if (!deployment) {
    return err({
      code: 'INSERT_FAILED' as const,
      message: 'Failed to create production deployment',
    })
  }

  // Reconcile app-level review state
  await reconcileAppReviewState({ appId: source.appId })

  return ok(deployment)
}
