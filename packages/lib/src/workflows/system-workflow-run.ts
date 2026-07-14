// packages/lib/src/workflows/system-workflow-run.ts
// Thin programmatic-start helper for system-owned workflows (Sequences plan §3.4,
// Phase 0). A sequence enrollment has no human actor and no trigger to dispatch
// through — it starts its hidden `WorkflowApp`'s workflow directly. Mirrors the
// createRun + executeWorkflowAsync shape used by
// `../workflow-engine/execution/trigger-manual-resource-workflow.ts`, swapping the
// human `createdBy` for the org's system user.

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { SystemUserService } from '../users/system-user-service'
import { RedisWorkflowExecutionReporter } from '../workflow-engine/execution-reporter'
import { WorkflowExecutionService } from './workflow-execution-service'

const logger = createScopedLogger('system-workflow-run')

/** The run row returned by `WorkflowExecutionService.createRun`. */
export type SystemWorkflowRun = Awaited<ReturnType<WorkflowExecutionService['createRun']>>

/**
 * Start a workflow run on behalf of the organization's system user — no
 * human actor and no trigger involved.
 *
 * Resolves the system user (`SystemUserService.getSystemUserForActions`),
 * creates the run in `'production'` mode, then fires `executeWorkflowAsync`
 * in the background (fire-and-forget, same as every other programmatic call
 * site) and returns the created run immediately so the caller can persist
 * `SequenceRun.workflowRunId` etc.
 */
export async function startSystemWorkflowRun(params: {
  workflowId: string
  inputs: Record<string, unknown>
  organizationId: string
}): Promise<Result<SystemWorkflowRun, Error>> {
  const { workflowId, inputs, organizationId } = params

  try {
    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    const executionService = new WorkflowExecutionService(db)

    const workflowRun = await executionService.createRun({
      workflowId,
      inputs,
      mode: 'production',
      userId: systemUserId,
      organizationId,
    })

    logger.info('Created system workflow run', {
      workflowId,
      workflowRunId: workflowRun.id,
      organizationId,
    })

    const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)

    // Fire-and-forget: errors are logged here and captured on the run row itself
    // (executeWorkflowAsync marks it FAILED internally); callers don't await execution.
    executionService.executeWorkflowAsync(workflowRun, reporter).catch((error) => {
      logger.error('Async system workflow execution failed', {
        workflowRunId: workflowRun.id,
        workflowId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    return ok(workflowRun)
  } catch (error) {
    logger.error('Failed to start system workflow run', {
      workflowId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error('Failed to start system workflow run'))
  }
}
