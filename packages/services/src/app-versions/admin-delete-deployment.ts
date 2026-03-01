// packages/services/src/app-versions/admin-delete-deployment.ts

import { AppDeployment, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Admin-only: Delete deployment
 */
export async function adminDeleteDeployment(params: { deploymentId: string; adminUserId: string }) {
  const { deploymentId } = params

  const deploymentResult = await fromDatabase(
    database.query.AppDeployment.findFirst({
      where: (d, { eq }) => eq(d.id, deploymentId),
    }),
    'get-deployment'
  )

  if (deploymentResult.isErr()) return deploymentResult

  if (!deploymentResult.value) {
    return err({ code: 'DEPLOYMENT_NOT_FOUND', message: 'Deployment not found', deploymentId })
  }

  const deleteResult = await fromDatabase(
    database.delete(AppDeployment).where(eq(AppDeployment.id, deploymentId)),
    'delete-deployment'
  )

  if (deleteResult.isErr()) return deleteResult

  return ok({ success: true })
}
