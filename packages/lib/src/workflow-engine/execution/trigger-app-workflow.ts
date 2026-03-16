// packages/lib/src/workflow-engine/execution/trigger-app-workflow.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok } from 'neverthrow'
import { getCachedWorkflowApp } from '../../cache'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'
import { RedisWorkflowExecutionReporter } from '../execution-reporter'

const logger = createScopedLogger('trigger-app-workflow')

/**
 * Execute an app-triggered workflow.
 *
 * Called by the trigger dispatch BullMQ worker for each matching workflow.
 * Creates a WorkflowRun with the trigger data in inputs and executes asynchronously.
 */
export async function executeAppTriggeredWorkflow(params: {
  workflowAppId: string
  organizationId: string
  triggerData: Record<string, unknown>
  appId: string
  triggerId: string
  installationId: string
  eventId: string
}) {
  const { workflowAppId, organizationId, triggerData, appId, triggerId, installationId, eventId } =
    params

  logger.info('Executing app-triggered workflow', {
    workflowAppId,
    organizationId,
    appId,
    triggerId,
    installationId,
    eventId,
  })

  // 1. Fetch and validate workflow from cache
  const workflowApp = await getCachedWorkflowApp(workflowAppId, organizationId)

  if (!workflowApp) {
    return err({
      code: 'WORKFLOW_APP_NOT_FOUND' as const,
      message: `Workflow app ${workflowAppId} not found or not enabled in organization ${organizationId}`,
      workflowAppId,
      organizationId,
    })
  }

  const publishedWorkflow = workflowApp.publishedWorkflow

  if (!publishedWorkflow) {
    return err({
      code: 'WORKFLOW_NOT_PUBLISHED' as const,
      message: `Workflow app ${workflowAppId} does not have a published workflow`,
      workflowAppId,
    })
  }

  if (
    publishedWorkflow.triggerType !== 'app-trigger' &&
    publishedWorkflow.triggerType !== 'app-polling-trigger'
  ) {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH' as const,
      message: `Workflow type mismatch. Expected 'app-trigger' or 'app-polling-trigger', got '${publishedWorkflow.triggerType}'`,
      expected: 'app-trigger',
      actual: publishedWorkflow.triggerType,
    })
  }

  // 2. Create and execute workflow
  try {
    const executionService = new WorkflowExecutionService(db)

    const workflowRun = await executionService.createRun({
      workflowId: publishedWorkflow.id,
      inputs: {
        // App's trigger data becomes node output variables
        ...triggerData,
        // Platform metadata nested under _meta to avoid polluting node outputs
        _meta: {
          trigger_type: 'app-trigger',
          app_id: appId,
          trigger_id: triggerId,
          installation_id: installationId,
          event_id: eventId,
          triggered_at: new Date().toISOString(),
        },
      },
      mode: 'production',
      userId: null,
      organizationId,
    })

    logger.info('Created workflow run for app trigger', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      appId,
      triggerId,
      installationId,
      eventId,
    })

    const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)

    // Execute workflow asynchronously (fire-and-forget)
    executionService.executeWorkflowAsync(workflowRun, reporter).catch((error) => {
      logger.error('Async app-triggered workflow execution failed', {
        workflowRunId: workflowRun.id,
        workflowAppId,
        appId,
        triggerId,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    return ok({ workflowRunId: workflowRun.id })
  } catch (error) {
    logger.error('Failed to create/execute app-triggered workflow', {
      workflowAppId,
      appId,
      triggerId,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    })

    return err({
      code: 'EXECUTION_FAILED' as const,
      message: `Failed to execute workflow: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}
