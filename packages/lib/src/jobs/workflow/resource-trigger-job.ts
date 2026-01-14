// packages/lib/src/jobs/workflow/resource-trigger-job.ts

import { Job } from 'bullmq'
import { createScopedLogger } from '@auxx/logger'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'
import { RedisWorkflowExecutionReporter } from '../../workflow-engine'
import { database as db } from '@auxx/database'
import { getWorkflowApp } from '@auxx/services/workflows'
import { SystemUserService } from '../../users/system-user-service'

const logger = createScopedLogger('resource-trigger-job')

/**
 * Job data for resource trigger execution
 */
export type ResourceTriggerJobData = {
  workflowAppId: string
  workflowId: string
  organizationId: string
  entityDefinitionId: string // NEW: replaces resourceType
  resourceData: any
  triggerType: string
  triggeredAt: string
}

/**
 * Execute a workflow triggered by a resource event
 * Fetches workflow app and executes the workflow with resource data
 */
export async function executeResourceTrigger(job: Job<ResourceTriggerJobData>) {
  const { workflowAppId, organizationId, entityDefinitionId, resourceData, triggerType } = job.data

  logger.info('Executing resource trigger', {
    workflowAppId,
    organizationId,
    entityDefinitionId,
    triggerType,
    jobId: job.id,
  })

  try {
    // 1. Fetch workflow app using service method
    const workflowAppResult = await getWorkflowApp({ workflowAppId, organizationId })

    if (workflowAppResult.isErr()) {
      const error = workflowAppResult.error

      // Log and skip if workflow not found/disabled (expected scenarios)
      if (
        error.code === 'WORKFLOW_APP_NOT_FOUND' ||
        error.code === 'WORKFLOW_NOT_PUBLISHED'
      ) {
        logger.warn('Workflow not found or disabled, skipping', {
          error: error.code,
          message: error.message,
          workflowAppId,
          organizationId,
          jobId: job.id,
        })
        return {
          skipped: true,
          reason: error.message,
          workflowAppId,
        }
      }

      // Throw for database errors (will retry)
      throw new Error(`Failed to fetch workflow app: ${error.message}`)
    }

    const { publishedWorkflow, organization } = workflowAppResult.value

    // 2. Create workflow run
    const executionService = new WorkflowExecutionService(db)

    const workflowRun = await executionService.createRun({
      workflowId: publishedWorkflow.id,
      inputs: {
        trigger_type: triggerType,
        entity_definition_id: entityDefinitionId,
        resource_id: resourceData.id,
        triggered_at: job.data.triggeredAt,

        // Store resource data under entity-specific key for workflow context
        // E.g., contact: {...}, ticket: {...}, or custom entity key
        [entityDefinitionId]: resourceData,
      },
      mode: 'production',
      userId:
        publishedWorkflow.createdById ||
        (await SystemUserService.getSystemUserForActions(organizationId)),
      organizationId,
    })

    logger.info('Created workflow run for resource trigger', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      entityDefinitionId,
      resourceId: resourceData.id,
      jobId: job.id,
    })

    // 3. Execute workflow asynchronously with reporter for node execution persistence
    const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)
    await executionService.executeWorkflowAsync(workflowRun, reporter)

    logger.info('Resource trigger executed successfully', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      entityDefinitionId,
      jobId: job.id,
    })

    return {
      success: true,
      workflowRunId: workflowRun.id,
      workflowAppId,
      executedAt: new Date().toISOString(),
    }
  } catch (error) {
    logger.error('Failed to execute resource trigger', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workflowAppId,
      organizationId,
      entityDefinitionId,
      jobId: job.id,
    })
    throw error
  }
}
