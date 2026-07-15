// packages/lib/src/jobs/workflow/message-trigger-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getCachedWorkflowApp } from '../../cache'
import { SystemUserService } from '../../users/system-user-service'
import { RedisWorkflowExecutionReporter } from '../../workflow-engine'
import { WorkflowTriggerType } from '../../workflow-engine/core/types'
import type { ProcessedMessage } from '../../workflow-engine/types/message'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'
import type { JobContext } from '../types'

const logger = createScopedLogger('message-trigger-job')

/**
 * Job data for MESSAGE_RECEIVED workflow trigger execution.
 */
export type MessageTriggerJobData = {
  workflowAppId: string
  workflowId: string
  organizationId: string
  /** Hydrated once by the dispatcher (`triggerMessageWorkflows`), reused as-is here. */
  messageData: ProcessedMessage
  messageId: string
  threadId?: string
  triggeredAt: string
}

/**
 * Execute a workflow triggered by a `message:received` event. Mirrors
 * `executeResourceTrigger` (`resource-trigger-job.ts`): fetch the workflow
 * app, create a production run, and execute it asynchronously. The hydrated
 * `ProcessedMessage` rides under the `message` input key, which
 * `ExecutionContextManager.initializeWithTrigger` hydrates into
 * `context.message` — exactly what `MessageReceivedProcessor.executeNode`
 * requires.
 */
export async function executeMessageTrigger(ctx: JobContext<MessageTriggerJobData>) {
  const job = ctx.job
  const { workflowAppId, organizationId, messageData, messageId, threadId } = job.data

  logger.info('Executing message trigger', {
    workflowAppId,
    organizationId,
    messageId,
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
        trigger_type: WorkflowTriggerType.MESSAGE_RECEIVED,
        message_id: messageId,
        thread_id: threadId,
        triggered_at: job.data.triggeredAt,
        message: messageData,
      },
      mode: 'production',
      userId:
        publishedWorkflow.createdById ||
        (await SystemUserService.getSystemUserForActions(organizationId)),
      organizationId,
    })

    logger.info('Created workflow run for message trigger', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      messageId,
      jobId: job.id,
    })

    // 3. Execute workflow asynchronously with reporter for node execution persistence
    const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)
    await executionService.executeWorkflowAsync(workflowRun, reporter)

    logger.info('Message trigger executed successfully', {
      workflowAppId,
      workflowRunId: workflowRun.id,
      messageId,
      jobId: job.id,
    })

    return {
      success: true,
      workflowRunId: workflowRun.id,
      workflowAppId,
      executedAt: new Date().toISOString(),
    }
  } catch (error) {
    logger.error('Failed to execute message trigger', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workflowAppId,
      organizationId,
      messageId,
      jobId: job.id,
    })
    throw error
  }
}
