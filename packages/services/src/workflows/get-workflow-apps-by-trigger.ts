// packages/services/src/workflows/get-workflow-apps-by-trigger.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Filter options for triggerConfig properties
 */
interface TriggerConfigFilter {
  /** Entity slug to filter by (for entity-manual-trigger) */
  entitySlug?: string
}

/**
 * Get all enabled workflow apps with published workflows matching a trigger type
 *
 * @param params.organizationId - Organization ID
 * @param params.triggerType - Trigger type to match
 * @param params.triggerConfigFilter - Optional filter for triggerConfig properties
 * @returns Result with array of workflow apps (empty array if none found)
 */
export async function getWorkflowAppsByTrigger(params: {
  organizationId: string
  triggerType: string
  triggerConfigFilter?: TriggerConfigFilter
}) {
  const { organizationId, triggerType, triggerConfigFilter } = params

  const dbResult = await fromDatabase(
    database.query.WorkflowApp.findMany({
      where: and(
        eq(schema.WorkflowApp.organizationId, organizationId),
        eq(schema.WorkflowApp.enabled, true)
      ),
      with: {
        publishedWorkflow: {
          where: (publishedWorkflow, { eq }) => eq(publishedWorkflow.triggerType, triggerType),
        },
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

  // Filter out apps without published workflows (left join may return null)
  let filteredApps = workflowApps
    .filter((app) => app.publishedWorkflow !== null)
    .map((app) => ({
      workflowApp: app,
      publishedWorkflow: app.publishedWorkflow!,
      organization: app.organization,
    }))

  // Apply triggerConfig filter if provided
  if (triggerConfigFilter?.entitySlug) {
    filteredApps = filteredApps.filter((app) => {
      const config = app.publishedWorkflow.triggerConfig as { entitySlug?: string } | null
      // Must have matching entitySlug - legacy workflows without entitySlug are excluded
      return config?.entitySlug === triggerConfigFilter.entitySlug
    })
  }

  return ok(filteredApps)
}
