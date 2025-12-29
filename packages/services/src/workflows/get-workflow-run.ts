// packages/services/src/workflows/get-workflow-run.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowRunEntity } from '@auxx/database/models'
import type { WorkflowEntity } from '@auxx/database/models'

/**
 * Get a workflow run with its related workflow
 * Validates that the run exists and matches the expected workflow ID
 *
 * @param params - Object containing runId and optional workflowId for validation
 * @returns Result with workflow run and workflow data
 */
export async function getWorkflowRun(params: {
  runId: string
  workflowId?: string
}) {
  const { runId, workflowId } = params

  const dbResult = await fromDatabase(
    database.query.WorkflowRun.findFirst({
      where: (runs, { eq }) => eq(runs.id, runId),
      with: {
        workflow: true,
      },
    }),
    'get-workflow-run'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const run = dbResult.value

  if (!run) {
    return err({
      code: 'WORKFLOW_RUN_NOT_FOUND' as const,
      message: `Workflow run not found: ${runId}`,
      runId,
    })
  }

  // Validate workflow ID if provided
  if (workflowId && run.workflowId !== workflowId) {
    return err({
      code: 'WORKFLOW_MISMATCH' as const,
      message: `Workflow run ${runId} does not belong to workflow ${workflowId}`,
      runId,
      workflowId,
    })
  }

  return ok(run as WorkflowRunEntity & { workflow: WorkflowEntity })
}
