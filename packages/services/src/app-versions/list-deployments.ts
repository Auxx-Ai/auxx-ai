// packages/services/src/app-versions/list-deployments.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * List deployments for an app, optionally filtered by type
 */
export async function listDeployments(params: {
  appId: string
  deploymentType?: 'development' | 'production'
}) {
  const { appId, deploymentType } = params

  const dbResult = await fromDatabase(
    database.query.AppDeployment.findMany({
      where: (deployments, { and, eq }) => {
        const conditions = [eq(deployments.appId, appId)]
        if (deploymentType) {
          conditions.push(eq(deployments.deploymentType, deploymentType))
        }
        return and(...conditions)
      },
      orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
      with: {
        clientBundle: true,
        serverBundle: true,
        createdBy: {
          columns: { id: true, name: true, email: true },
        },
        targetOrganization: {
          columns: { id: true, name: true, slug: true },
        },
      },
    }),
    'list-deployments'
  )

  if (dbResult.isErr()) return err(dbResult.error)

  return ok(dbResult.value)
}
