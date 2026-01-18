// packages/lib/src/workflow-engine/execution/trigger-manual-resource-workflow.ts

import { err, ok } from 'neverthrow'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'
import { createScopedLogger } from '@auxx/logger'
import { getWorkflowApp } from '@auxx/services/workflows'
import { database as db } from '@auxx/database'
import { fetchResourceById } from '../../resources'
import { RedisWorkflowExecutionReporter } from '../execution-reporter'
import { parseRecordId, type RecordId } from '@auxx/types/resource'

const logger = createScopedLogger('trigger-manual-workflow')

/**
 * Manually trigger a specific workflow for a resource
 *
 * UX Flow:
 * 1. User views resource (contact, ticket, etc.)
 * 2. Dropdown shows available manual workflows for that entity
 * 3. User selects ONE workflow
 * 4. This function triggers that specific workflow
 *
 * Security:
 * - Verifies workflow belongs to organization
 * - Verifies workflow is enabled
 * - Verifies workflow trigger type is 'manual' and entityDefinitionId matches
 * - Verifies resource belongs to organization
 *
 * @param params - Trigger parameters
 * @returns Result with workflow run ID or error
 */
export async function triggerManualResourceWorkflow(params: {
  workflowAppId: string
  recordId: RecordId
  organizationId: string
  createdBy: string
}) {
  const { workflowAppId, recordId, organizationId, createdBy } = params

  // Parse RecordId to get both components
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  logger.info('Manual trigger started', {
    workflowAppId,
    entityDefinitionId,
    entityInstanceId,
    recordId,
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

  // Verify workflow trigger type is 'manual' and entityDefinitionId matches
  if (publishedWorkflow.triggerType !== 'manual') {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH' as const,
      message: `Workflow type mismatch. Expected 'manual', got '${publishedWorkflow.triggerType}'`,
      expected: 'manual',
      actual: publishedWorkflow.triggerType,
    })
  }

  if (publishedWorkflow.entityDefinitionId !== entityDefinitionId) {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH' as const,
      message: `Entity definition mismatch. Expected '${entityDefinitionId}', got '${publishedWorkflow.entityDefinitionId}'`,
      expected: entityDefinitionId,
      actual: publishedWorkflow.entityDefinitionId,
    })
  }

  // 2. Fetch resource and verify organization ownership
  const resourceData = await fetchResourceById(recordId, organizationId)

  if (!resourceData) {
    return err({
      code: 'RESOURCE_NOT_FOUND' as const,
      message: `Resource ${entityInstanceId} not found or does not belong to organization ${organizationId}`,
      entityDefinitionId,
      entityInstanceId,
      recordId,
    })
  }

  // 3. Create and execute workflow
  try {
    const executionService = new WorkflowExecutionService(db)

    // Create workflow run
    const workflowRun = await executionService.createRun({
      workflowId: publishedWorkflow.id,
      inputs: {
        trigger_type: 'manual',
        entity_definition_id: entityDefinitionId,
        resource_id: entityInstanceId,
        triggered_at: new Date().toISOString(),
        [entityDefinitionId]: resourceData, // Store resource data under entity-specific key
        createdBy, // User ID for audit trail
      },
      mode: 'production',
      userId: createdBy,
      organizationId,
    })

    logger.info('Created workflow run for manual trigger', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      entityDefinitionId,
      entityInstanceId,
      recordId,
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
        entityInstanceId,
        recordId,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    logger.info('Manual trigger initiated', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      entityDefinitionId,
      entityInstanceId,
      recordId,
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
