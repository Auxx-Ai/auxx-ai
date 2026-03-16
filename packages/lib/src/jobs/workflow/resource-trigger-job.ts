// packages/lib/src/jobs/workflow/resource-trigger-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { getCachedWorkflowApp } from '../../cache'
import { SystemUserService } from '../../users/system-user-service'
import { RedisWorkflowExecutionReporter } from '../../workflow-engine'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'

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
    // 1. Fetch workflow app from cache
    const workflowApp = await getCachedWorkflowApp(workflowAppId, organizationId)

    if (!workflowApp) {
      logger.warn('Workflow not found or disabled, skipping', {
        workflowAppId,
        organizationId,
        jobId: job.id,
      })
      return {
        skipped: true,
        reason: `Workflow app ${workflowAppId} not found or not enabled`,
        workflowAppId,
      }
    }

    const publishedWorkflow = workflowApp.publishedWorkflow

    if (!publishedWorkflow) {
      logger.warn('Workflow not published, skipping', {
        workflowAppId,
        organizationId,
        jobId: job.id,
      })
      return {
        skipped: true,
        reason: `Workflow app ${workflowAppId} does not have a published workflow`,
        workflowAppId,
      }
    }

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
