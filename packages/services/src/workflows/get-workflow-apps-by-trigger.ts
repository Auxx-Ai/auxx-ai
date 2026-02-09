// packages/services/src/workflows/get-workflow-apps-by-trigger.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Get all enabled workflow apps with published workflows matching trigger criteria
 *
 * @param params.organizationId - Organization ID
 * @param params.triggerType - Trigger operation type (manual, created, updated, deleted, form, scheduled, message-received)
 * @param params.entityDefinitionId - Optional entity filter (for resource triggers)
 * @returns Result with array of workflow apps (empty array if none found)
 */
export async function getWorkflowAppsByTrigger(params: {
  organizationId: string
  triggerType: string
  entityDefinitionId?: string
}) {
  const { organizationId, triggerType, entityDefinitionId } = params

  // Build where conditions
  const whereConditions = [
    eq(schema.WorkflowApp.organizationId, organizationId),
    eq(schema.WorkflowApp.enabled, true),
  ]

  const dbResult = await fromDatabase(
    database.query.WorkflowApp.findMany({
      where: and(...whereConditions),
      with: {
        publishedWorkflow: true,
        organization: {
          columns: {
            name: true,
          },
        },
      },
    }),
    'get-workflow-apps-by-trigger'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const workflowApps = dbResult.value

  // Filter apps by published workflow trigger criteria
  const filteredApps = workflowApps
    .filter((app) => {
      if (!app.publishedWorkflow) return false
      if (app.publishedWorkflow.triggerType !== triggerType) return false
      if (entityDefinitionId && app.publishedWorkflow.entityDefinitionId !== entityDefinitionId)
        return false
      return true
    })
    .map((app) => ({
      workflowApp: app,
      publishedWorkflow: app.publishedWorkflow!,
      organization: app.organization,
    }))

  return ok(filteredApps)
}
