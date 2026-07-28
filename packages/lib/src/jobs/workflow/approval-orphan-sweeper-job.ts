// packages/lib/src/jobs/workflow/approval-orphan-sweeper-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { ApprovalQueryService } from '../../workflow-engine/services/approval-query-service'
import type { JobContext } from '../types'

const logger = createScopedLogger('approval-orphan-sweeper')

interface ApprovalOrphanSweeperJobData {
  /**
   * Optional single-org scope. Omitted on the scheduled tick — the sweep is
   * global by default because orphaned approvals are janitorial state nobody
   * is waiting on, and one statement covers every org.
   */
  organizationId?: string
}

export interface ApprovalOrphanSweeperStats {
  swept: number
}

/**
 * Sweeps orphaned workflow approval requests.
 *
 * A human-in-the-loop node parks an `ApprovalRequest` in `pending` and waits
 * for a response. If its `WorkflowRun` reaches a terminal state (STOPPED,
 * FAILED, SUCCEEDED) without the approval ever being answered, the request is
 * stranded: nothing will resume on it, it never expires on its own if its
 * `expiresAt` is far out, and it keeps showing up as actionable work.
 *
 * `cleanupApprovalsForWorkflowRun` covers the case where a run is stopped
 * through a code path that knows to clean up. This periodic sweep is the
 * backstop for runs that terminated any other way (crash, retry exhaustion,
 * direct status write).
 *
 * Previously this only ran when a user pressed "Clean Up Stopped" in the
 * human-confirmation dialog. That dialog is gone; the work now happens on a
 * schedule so no user has to think about it.
 */
export async function approvalOrphanSweeperJob(
  ctx: JobContext<ApprovalOrphanSweeperJobData>
): Promise<ApprovalOrphanSweeperStats> {
  const { organizationId } = ctx.job.data ?? {}

  logger.info('Starting orphaned approval sweep', { organizationId, jobId: ctx.job.id })

  try {
    const service = new ApprovalQueryService(database)
    const swept = await service.cleanupOrphanedApprovals(organizationId)

    logger.info('Orphaned approval sweep finished', { organizationId, swept })
    return { swept }
  } catch (error) {
    logger.error('Orphaned approval sweep failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}
