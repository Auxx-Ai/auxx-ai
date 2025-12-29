// packages/services/src/workflow-share/get-workflow-by-api-key.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok, err, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowShareError } from './errors'
import { hashApiKey } from '@auxx/credentials/api-key'
import type { WorkflowShareIcon, WorkflowShareConfig, WorkflowRateLimitConfig } from './types'

/**
 * Workflow data returned when looking up by API key
 */
export interface WorkflowByApiKey {
  id: string
  organizationId: string
  name: string
  description: string | null
  enabled: boolean
  apiEnabled: boolean
  config: WorkflowShareConfig | null
  rateLimit: WorkflowRateLimitConfig | null
  apiKeyId: string
  /** Published workflow ID for execution */
  publishedWorkflowId: string | null
  /** Optional raw graph data (when includeGraph: true) */
  graph?: unknown | null
}

/**
 * Options for fetching workflow by API key
 */
export interface GetWorkflowByApiKeyOptions {
  apiKey: string
  /** If true, include the workflow graph for input extraction */
  includeGraph?: boolean
}

/**
 * Get workflow by API key
 * Looks up the API key, validates it, and returns the linked workflow
 *
 * @param options - Query options
 * @returns Result with workflow data or error
 */
export async function getWorkflowByApiKey(options: GetWorkflowByApiKeyOptions) {
  const { apiKey, includeGraph = false } = options

  const hashedKey = hashApiKey(apiKey)

  // Find the API key and join with workflow
  const dbResult = await fromDatabase(
    database.query.ApiKey.findFirst({
      where: and(
        eq(schema.ApiKey.hashedKey, hashedKey),
        eq(schema.ApiKey.type, 'workflow'),
        eq(schema.ApiKey.isActive, true)
      ),
      columns: {
        id: true,
        referenceId: true,
      },
    }),
    'get-workflow-by-api-key'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const apiKeyRecord = dbResult.value

  if (!apiKeyRecord || !apiKeyRecord.referenceId) {
    return err({
      code: 'INVALID_API_KEY' as const,
      message: 'Invalid or expired API key',
    })
  }

  // Now fetch the workflow
  const workflowResult = await fromDatabase(
    database.query.WorkflowApp.findFirst({
      where: eq(schema.WorkflowApp.id, apiKeyRecord.referenceId),
      columns: {
        id: true,
        organizationId: true,
        name: true,
        description: true,
        enabled: true,
        apiEnabled: true,
        config: true,
        rateLimit: true,
        workflowId: true,
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
    'get-workflow-by-api-key'
  )

  if (workflowResult.isErr()) {
    return err(workflowResult.error)
  }

  const workflow = workflowResult.value

  if (!workflow) {
    return err({
      code: 'WORKFLOW_NOT_FOUND' as const,
      message: 'Workflow not found',
    })
  }

  // Check if API access is enabled
  if (!workflow.apiEnabled) {
    return err({
      code: 'API_ACCESS_DISABLED' as const,
      message: 'API access is not enabled for this workflow',
    })
  }

  // Check if workflow is enabled
  if (!workflow.enabled) {
    return err({
      code: 'WORKFLOW_DISABLED' as const,
      message: 'Workflow is disabled',
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
    apiEnabled: workflow.apiEnabled,
    config: workflow.config as WorkflowShareConfig | null,
    rateLimit: workflow.rateLimit as WorkflowRateLimitConfig | null,
    apiKeyId: apiKeyRecord.id,
    publishedWorkflowId: workflow.workflowId,
    graph,
  })
}
