// packages/lib/src/jobs/workflow/scheduled-trigger-job.ts

import { database as db, schema } from '@auxx/database'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { RedisWorkflowExecutionReporter } from '../../workflow-engine'
import { WorkflowNodeType } from '../../workflow-engine/core/types'
import type { ScheduledTriggerConfig } from '../../workflows/scheduled-trigger-service'
import { ScheduledTriggerService } from '../../workflows/scheduled-trigger-service'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'

const logger = createScopedLogger('scheduled-trigger-job')

export type ScheduledTriggerJobData = {
  workflowAppId: string
  organizationId: string
  nodeId: string
  triggerConfig: ScheduledTriggerConfig
}

/**
 * Cancel the scheduler for a workflow that is no longer valid
 */
async function cancelInvalidWorkflowScheduler(
  workflowAppId: string,
  reason: string
): Promise<void> {
  try {
    const scheduledTriggerService = new ScheduledTriggerService()
    await scheduledTriggerService.unscheduleWorkflowTriggers(workflowAppId)

    logger.warn('Cancelled scheduler for invalid workflow', {
      workflowAppId,
      reason,
      action: 'scheduler_cancelled',
    })
  } catch (error) {
    logger.error('Failed to cancel scheduler for invalid workflow', {
      workflowAppId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Execute a scheduled trigger for a workflow
 */
export async function executeScheduledTrigger(job: Job<ScheduledTriggerJobData>) {
  const { workflowAppId, organizationId, nodeId, triggerConfig } = job.data

  logger.info('Executing scheduled trigger', {
    workflowAppId,
    organizationId,
    nodeId,
    jobId: job.id,
  })

  try {
    // First check if workflow app exists at all (could be deleted)
    const [workflowAppExists] = await db
      .select({
        id: schema.WorkflowApp.id,
        enabled: schema.WorkflowApp.enabled,
      })
      .from(schema.WorkflowApp)
      .where(
        and(
          eq(schema.WorkflowApp.id, workflowAppId),
          eq(schema.WorkflowApp.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!workflowAppExists) {
      const reason = 'Workflow has been deleted'
      logger.warn('Scheduled trigger skipped - workflow deleted', {
        workflowAppId,
        organizationId,
        nodeId,
        jobId: job.id,
      })

      // Cancel future jobs since this workflow no longer exists
      await cancelInvalidWorkflowScheduler(workflowAppId, reason)

      return {
        skipped: true,
        reason,
        workflowAppId,
        nodeId,
        schedulerCancelled: true,
      }
    }

    // Now verify workflow is still published and enabled
    const [workflowAppData] = await db
      .select({
        workflowApp: schema.WorkflowApp,
        publishedWorkflow: schema.Workflow,
        organization: {
          name: schema.Organization.name,
        },
      })
      .from(schema.WorkflowApp)
      .leftJoin(schema.Workflow, eq(schema.Workflow.id, schema.WorkflowApp.workflowId))
      .leftJoin(schema.Organization, eq(schema.Organization.id, schema.WorkflowApp.organizationId))
      .where(
        and(
          eq(schema.WorkflowApp.id, workflowAppId),
          eq(schema.WorkflowApp.organizationId, organizationId),
          eq(schema.WorkflowApp.enabled, true) // Only execute if workflow is enabled
        )
      )
      .limit(1)

    const workflowApp = workflowAppData
      ? {
          ...workflowAppData.workflowApp,
          publishedWorkflow: workflowAppData.publishedWorkflow,
          organization: workflowAppData.organization,
        }
      : null

    if (!workflowApp?.publishedWorkflow) {
      const reason = 'Workflow not published or disabled'
      logger.warn('Scheduled trigger skipped - workflow not published or disabled', {
        workflowAppId,
        organizationId,
        nodeId,
        jobId: job.id,
      })

      // Cancel future jobs since this workflow is no longer valid
      await cancelInvalidWorkflowScheduler(workflowAppId, reason)

      return {
        skipped: true,
        reason,
        workflowAppId,
        nodeId,
        schedulerCancelled: true,
      }
    }

    // Verify the scheduled trigger node still exists and is enabled in the published workflow
    const publishedGraph = workflowApp.publishedWorkflow.graph as any

    // Debug logging to understand node structure
    const targetNode = publishedGraph?.nodes?.find((node: any) => node.id === nodeId)
    logger.info('Debugging scheduled trigger node validation', {
      workflowAppId,
      nodeId,
      targetNodeFound: !!targetNode,
      targetNodeType: targetNode?.type,
      targetNodeDataType: targetNode?.data?.type,
      targetNodeEnabled: targetNode?.data?.isEnabled,
      totalNodes: publishedGraph?.nodes?.length || 0,
    })

    const triggerNode = publishedGraph?.nodes?.find(
      (node: any) =>
        node.id === nodeId &&
        node.data?.type === WorkflowNodeType.SCHEDULED &&
        node.data?.isEnabled !== false
    )

    if (!triggerNode) {
      const reason = 'Trigger node not found or disabled in published workflow'
      logger.warn('Scheduled trigger skipped - node not found or disabled', {
        workflowAppId,
        organizationId,
        nodeId,
        jobId: job.id,
      })

      // Cancel future jobs since this trigger node is no longer valid
      await cancelInvalidWorkflowScheduler(workflowAppId, reason)

      return {
        skipped: true,
        reason,
        workflowAppId,
        nodeId,
        schedulerCancelled: true,
      }
    }

    // Create trigger event data
    const triggerEvent = {
      type: 'SCHEDULED' as const,
      data: {
        scheduledTime: new Date().toISOString(),
        nodeId,
        triggerConfig,
        triggeredBy: 'scheduler',
        jobId: job.id,
      },
      timestamp: new Date(),
      organizationId,
      organizationName: workflowApp.organization?.name,
    }

    // Execute workflow via service
    const executionService = new WorkflowExecutionService(db)

    // Create a new workflow run for the scheduled execution
    const workflowRun = await executionService.createRun({
      workflowId: workflowApp.publishedWorkflow.id,
      inputs: {
        // Pass trigger data as inputs
        trigger_type: 'scheduled',
        scheduled_time: triggerEvent.data.scheduledTime,
        node_id: nodeId,
        trigger_config: triggerConfig,
      },
      mode: 'production',
      userId: workflowApp.createdById || 'system', // Use workflow creator or system
      organizationId,
      // Note: no user email/name for scheduled triggers
    })

    logger.info('Created workflow run for scheduled trigger', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      nodeId,
      jobId: job.id,
    })

    // Execute the workflow asynchronously with reporter for node execution persistence
    const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)
    await executionService.executeWorkflowAsync(workflowRun, reporter)

    logger.info('Scheduled trigger executed successfully', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      nodeId,
      jobId: job.id,
    })

    return {
      success: true,
      workflowRunId: workflowRun.id,
      workflowAppId,
      nodeId,
      executedAt: new Date().toISOString(),
    }
  } catch (error) {
    logger.error('Failed to execute scheduled trigger', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workflowAppId,
      organizationId,
      nodeId,
      jobId: job.id,
    })
    throw error
  }
}
