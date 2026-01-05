// packages/lib/src/workflow-engine/execution/trigger-manual-resource-workflow.ts

import { err, ok } from 'neverthrow'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'
import { createScopedLogger } from '@auxx/logger'
import { getWorkflowApp } from '@auxx/services/workflows'
import { database as db } from '@auxx/database'
import { fetchResourceById } from '../../resources'
import { RedisWorkflowExecutionReporter } from '../execution-reporter'

const logger = createScopedLogger('trigger-manual-workflow')

/**
 * Manually trigger a specific workflow for a resource
 *
 * UX Flow:
 * 1. User views resource (contact, ticket, etc.)
 * 2. Dropdown shows available manual workflows for that resource type
 * 3. User selects ONE workflow
 * 4. This function triggers that specific workflow
 *
 * Security:
 * - Verifies workflow belongs to organization
 * - Verifies workflow is enabled
 * - Verifies workflow type matches resource type
 * - Verifies resource belongs to organization
 *
 * @param params - Trigger parameters
 * @returns Result with workflow run ID or error
 */
export async function triggerManualResourceWorkflow(params: {
  workflowAppId: string
  resourceType: string
  resourceId: string
  entitySlug?: string // Required when resourceType === 'entity'
  organizationId: string
  createdBy: string
}) {
  const { workflowAppId, resourceType, resourceId, entitySlug, organizationId, createdBy } = params

  logger.info('Manual trigger started', {
    workflowAppId,
    resourceType,
    resourceId,
    entitySlug,
    organizationId,
    createdBy,
  })

  // 1. Fetch and validate workflow
  const workflowResult = await getWorkflowApp({
    workflowAppId,
    organizationId,
  })

  if (workflowResult.isErr()) {
    return err(workflowResult.error)
  }

  const { workflowApp, publishedWorkflow, organization } = workflowResult.value

  if (!workflowApp.enabled) {
    return err({
      code: 'WORKFLOW_NOT_ENABLED' as const,
      message: `Workflow ${workflowAppId} is not enabled`,
      workflowAppId,
    })
  }

  // Verify workflow type matches resource type
  const expectedTriggerType = `${resourceType}-manual-trigger`
  if (publishedWorkflow.triggerType !== expectedTriggerType) {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH' as const,
      message: `Workflow type mismatch. Expected ${expectedTriggerType}, got ${publishedWorkflow.triggerType}`,
      expected: expectedTriggerType,
      actual: publishedWorkflow.triggerType,
    })
  }

  // 2. Fetch resource and verify organization ownership
  // resourceType is already in the correct format (system ID or UUID for custom entities)
  const resourceData = await fetchResourceById(resourceType as any, resourceId, organizationId)

  if (!resourceData) {
    return err({
      code: 'RESOURCE_NOT_FOUND' as const,
      message: `${resourceType} ${resourceId} not found or does not belong to organization ${organizationId}`,
      resourceType,
      resourceId,
    })
  }

  // 3. Create and execute workflow
  try {
    const executionService = new WorkflowExecutionService(db)

    // Create workflow run
    // Use fetchResourceType for resource_type and data key so trigger node can find it
    const workflowRun = await executionService.createRun({
      workflowId: publishedWorkflow.id,
      inputs: {
        trigger_type: expectedTriggerType,
        resource_type: fetchResourceType,
        resource_id: resourceId,
        triggered_at: new Date().toISOString(),
        [fetchResourceType]: resourceData, // Key must match trigger node's resourceType config
        createdBy, // User ID for audit trail
      },
      mode: 'production',
      userId: createdBy,
      organizationId,
    })

    logger.info('Created workflow run for manual trigger', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      resourceType,
      resourceId,
      createdBy,
    })

    // Create reporter for SSE events
    const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)

    // Execute workflow asynchronously (fire-and-forget)
    // Returns immediately so client can subscribe to SSE events
    // Errors are logged and emitted via Redis pub/sub, stored in DB
    executionService.executeWorkflowAsync(workflowRun, reporter).catch((error) => {
      logger.error('Async workflow execution failed', {
        workflowRunId: workflowRun.id,
        workflowAppId,
        resourceId,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    logger.info('Manual trigger initiated', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      resourceType,
      resourceId,
      organizationId,
    })

    return ok({
      workflowRunId: workflowRun.id,
    })
  } catch (error) {
    logger.error('Manual trigger execution failed', {
      workflowAppId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return err({
      code: 'WORKFLOW_EXECUTION_FAILED' as const,
      message: error instanceof Error ? error.message : 'Workflow execution failed',
      workflowAppId,
      cause: error,
    })
  }
}
