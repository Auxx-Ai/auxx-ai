// packages/services/src/workflows/get-workflow-app.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { DatabaseError } from '../shared/errors'

/**
 * Workflow app error types
 */
export type WorkflowAppError =
  | DatabaseError
  | {
      code: 'WORKFLOW_APP_NOT_FOUND'
      message: string
      workflowAppId: string
      organizationId: string
    }
  | {
      code: 'WORKFLOW_NOT_PUBLISHED'
      message: string
      workflowAppId: string
    }

/**
 * Get workflow app with published workflow and organization details
 *
 * @param params - Object containing workflowAppId and organizationId
 * @returns Result with workflow app data or an error
 */
export async function getWorkflowApp(params: { workflowAppId: string; organizationId: string }) {
  const { workflowAppId, organizationId } = params

  const dbResult = await fromDatabase(
    database.query.WorkflowApp.findFirst({
      where: and(
        eq(schema.WorkflowApp.id, workflowAppId),
        eq(schema.WorkflowApp.organizationId, organizationId),
        eq(schema.WorkflowApp.enabled, true)
      ),
      with: {
        publishedWorkflow: true,
        organization: {
          columns: {
            name: true,
          },
        },
      },
    }),
    'get-workflow-app'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const workflowAppData = dbResult.value

  // Workflow app not found
  if (!workflowAppData) {
    return err({
      code: 'WORKFLOW_APP_NOT_FOUND' as const,
      message: `Workflow app ${workflowAppId} not found or not enabled in organization ${organizationId}`,
      workflowAppId,
      organizationId,
    })
  }

  // Workflow not published
  if (!workflowAppData.publishedWorkflow) {
    return err({
      code: 'WORKFLOW_NOT_PUBLISHED' as const,
      message: `Workflow app ${workflowAppId} does not have a published workflow`,
      workflowAppId,
    })
  }

  // Success
  return ok({
    workflowApp: workflowAppData,
    publishedWorkflow: workflowAppData.publishedWorkflow,
    organization: workflowAppData.organization,
  })
}
