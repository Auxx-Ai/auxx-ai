// packages/lib/src/jobs/workflow/resume-workflow-job.ts

import { Job } from 'bullmq'
import { createScopedLogger } from '@auxx/logger'
import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { publisher } from '../../events/publisher'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'

const logger = createScopedLogger('ResumeWorkflowJob')

export type ResumeWorkflowJobData = {
  workflowRunId: string
  resumeFromNodeId: string
  /** Optional: Output data to pass to the resumed node */
  nodeOutput?: Record<string, any>
}

/**
 * Job handler for resuming paused workflows
 */
export async function resumeWorkflowJob(job: Job<ResumeWorkflowJobData>) {
  const { workflowRunId, resumeFromNodeId, nodeOutput: providedOutput } = job.data

  logger.info('Resuming workflow', { workflowRunId, resumeFromNodeId })

  // Fetch workflow run once for event publishing
  const workflowRun = await db.query.WorkflowRun.findFirst({
    where: eq(schema.WorkflowRun.id, workflowRunId),
    columns: { organizationId: true },
  })

  if (!workflowRun) {
    throw new Error(`Workflow run ${workflowRunId} not found`)
  }

  try {
    // Use the proper service layer for resuming workflows
    const workflowExecutionService = new WorkflowExecutionService()

    logger.info('Resuming workflow via service', { workflowRunId, resumeFromNodeId })

    // Use provided output if available (e.g., from document processing flow),
    // otherwise use default output for wait nodes
    const nodeOutput = providedOutput || {
      wait_method: 'queue_delay',
      resumed_from_queue: true,
      resumed_at: new Date().toISOString(),
      actual_resume_time: new Date().toISOString(),
      // Note: wait_duration_ms will be preserved from the original pause output during merge
    }

    await workflowExecutionService.resumeWorkflow(workflowRunId, resumeFromNodeId, nodeOutput)

    // Emit success event via publisher (this will be replaced by service events eventually)
    await publisher.publishLater({
      type: 'workflow:resumed',
      data: {
        workflowRunId,
        organizationId: workflowRun.organizationId,
        resumedNodeId: resumeFromNodeId,
        resumedAt: new Date().toISOString(),
      },
    } as any)

    logger.info('Workflow resumed successfully', { workflowRunId })
    return { success: true, workflowRunId }
  } catch (error) {
    logger.error('Failed to resume workflow', {
      error: error instanceof Error ? error.message : String(error),
      workflowRunId,
      resumeFromNodeId,
    })

    // The service layer will handle proper error states
    // But we should still emit a failure event for the job system
    try {
      await publisher.publishLater({
        type: 'workflow:resume:failed',
        data: {
          workflowRunId,
          resumeFromNodeId,
          error: error instanceof Error ? error.message : String(error),
          organizationId: workflowRun.organizationId,
          failedAt: new Date().toISOString(),
        },
      } as any)
    } catch (publishError) {
      logger.error('Failed to publish resume failure event', {
        publishError: publishError instanceof Error ? publishError.message : String(publishError),
        originalError: error instanceof Error ? error.message : String(error),
      })
    }

    throw error
  }
}
