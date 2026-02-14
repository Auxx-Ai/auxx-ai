// packages/services/src/workflow-share/get-shared-workflow-by-token.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowShareError } from './errors'
import type {
  SharedWorkflow,
  WorkflowRateLimitConfig,
  WorkflowShareAccessMode,
  WorkflowShareConfig,
  WorkflowShareIcon,
} from './types'

/**
 * Options for fetching shared workflow
 */
export interface GetSharedWorkflowByTokenOptions {
  shareToken: string
  /** If true, also check that workflow.enabled is true */
  requireEnabled?: boolean
  /** If true, include the sanitized workflow graph */
  includeGraph?: boolean
}

/**
 * Get workflow by share token
 * Returns workflow if it has web or API access enabled
 *
 * @param options - Query options
 * @returns Result with workflow data or error
 */
export async function getSharedWorkflowByToken(
  options: GetSharedWorkflowByTokenOptions
): Promise<Result<SharedWorkflow, WorkflowShareError>> {
  const { shareToken, requireEnabled = true, includeGraph = false } = options

  const dbResult = await fromDatabase(
    database.query.WorkflowApp.findFirst({
      where: eq(schema.WorkflowApp.shareToken, shareToken),
      columns: {
        id: true,
        organizationId: true,
        name: true,
        description: true,
        enabled: true,
        shareToken: true,
        webEnabled: true,
        apiEnabled: true,
        icon: true,
        accessMode: true,
        config: true,
        rateLimit: true,
      },
      with: includeGraph
        ? {
            publishedWorkflow: {
              columns: {
                graph: true,
              },
            },
          }
        : undefined,
    }),
    'get-shared-workflow-by-token'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const workflow = dbResult.value

  if (!workflow || !workflow.shareToken) {
    return err({
      code: 'WORKFLOW_NOT_FOUND' as const,
      message: `Workflow with share token ${shareToken} not found`,
      shareToken,
    })
  }

  // Check if at least one access method is enabled
  if (!workflow.webEnabled && !workflow.apiEnabled) {
    return err({
      code: 'WORKFLOW_SHARING_DISABLED' as const,
      message: `Access is disabled for this workflow`,
      shareToken,
    })
  }

  if (requireEnabled && !workflow.enabled) {
    return err({
      code: 'WORKFLOW_DISABLED' as const,
      message: `Workflow is disabled`,
      workflowAppId: workflow.id,
    })
  }

  // Include raw graph if requested
  const graph = includeGraph
    ? ((workflow as { publishedWorkflow?: { graph: unknown } }).publishedWorkflow?.graph ?? null)
    : undefined

  return ok({
    id: workflow.id,
    organizationId: workflow.organizationId,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    shareToken: workflow.shareToken,
    webEnabled: workflow.webEnabled,
    apiEnabled: workflow.apiEnabled,
    icon: workflow.icon as WorkflowShareIcon | null,
    accessMode: (workflow.accessMode || 'public') as WorkflowShareAccessMode,
    config: workflow.config as WorkflowShareConfig | null,
    rateLimit: workflow.rateLimit as WorkflowRateLimitConfig | null,
    graph,
  })
}
