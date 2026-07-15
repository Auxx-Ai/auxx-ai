// packages/lib/src/sequences/reanchor.ts
// Belt-and-suspenders re-anchor hook (client-notifications plan §4.2) — the primary defense
// is the send node's own live-anchor recompute guard (`evaluateSubjectGuards`), but a
// subject-date change (visit reschedule, invoice due-date edit) should move a PENDING wait's
// resume time immediately rather than wait for that step to wake up on its own stale schedule.
// `scheduleVisit` calls this in a later phase — this file only builds + exports it.

import { database, schema } from '@auxx/database'
import { WorkflowRunStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getQueue, Queues } from '../jobs/queues'
import { buildWorkflowResumeJobId } from '../workflow-engine/nodes/wait/resume-job-id'
import { WorkflowExecutionService } from '../workflows/workflow-execution-service'
import { computeAnchorTarget, isPastAnchor } from './anchor'

const logger = createScopedLogger('sequences-reanchor')

export type ReanchorSubjectKind = 'visit' | 'work_order' | 'invoice'

export interface ReanchorSequenceRunsResult {
  /** Active runs found for this subject (any timing mode, any paused/unpaused state). */
  inspected: number
  /** Runs whose pending anchored wait was actually moved (future target) or resumed
   * immediately (past/null target — the send node's guard decides skip/exit from there). */
  reanchored: number
}

/**
 * Re-anchor every active run parked on an anchored wait for `(organizationId, subjectKind,
 * subjectId)` to a new anchor date (visit reschedule / invoice due-date edit). Runs not
 * currently `WAITING`, or waiting on a RELATIVE (non-anchor) step, are left untouched — only
 * anchor-mode waits move. For each affected run: recompute `target` from `newAnchorDate` +
 * the paused step's offset/timeOfDay, in the sequence's delivery timezone. A future target
 * moves the BullMQ delay job (remove + re-add under the same deterministic jobId); a past (or
 * null) target resumes the workflow immediately instead — the sequence-send-email node's own
 * live-anchor guard (§4.4) recomputes again at send time and skips/exits as appropriate, so
 * this never risks sending late.
 */
export async function reanchorSequenceRuns(
  organizationId: string,
  subjectKind: ReanchorSubjectKind,
  subjectId: string,
  newAnchorDate: Date
): Promise<Result<ReanchorSequenceRunsResult, Error>> {
  try {
    const runs = await database.query.SequenceRun.findMany({
      where: and(
        eq(schema.SequenceRun.organizationId, organizationId),
        eq(schema.SequenceRun.subjectKind, subjectKind),
        eq(schema.SequenceRun.subjectId, subjectId),
        eq(schema.SequenceRun.status, 'active')
      ),
      columns: { id: true, workflowRunId: true, sequenceId: true },
    })
    if (runs.length === 0) return ok({ inspected: 0, reanchored: 0 })

    const executionService = new WorkflowExecutionService(database)
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
    let reanchored = 0

    for (const run of runs) {
      const workflowRun = await database.query.WorkflowRun.findFirst({
        where: eq(schema.WorkflowRun.id, run.workflowRunId),
        columns: { status: true, pausedNodeId: true },
      })
      if (
        !workflowRun ||
        workflowRun.status !== WorkflowRunStatus.WAITING ||
        !workflowRun.pausedNodeId
      ) {
        continue // not currently parked on a wait — nothing to move
      }

      // Compiled node id convention (`publish.ts`'s `buildSequenceGraph`): `wait-${step.id}`.
      const stepId = workflowRun.pausedNodeId.replace(/^wait-/, '')
      const step = await database.query.SequenceStep.findFirst({
        where: and(
          eq(schema.SequenceStep.id, stepId),
          eq(schema.SequenceStep.sequenceId, run.sequenceId)
        ),
        columns: { timingMode: true, anchorOffsetDays: true, anchorTimeOfDay: true },
      })
      if (!step || step.timingMode !== 'anchor') continue // relative step — not our concern

      const sequence = await database.query.Sequence.findFirst({
        where: eq(schema.Sequence.id, run.sequenceId),
        columns: { deliveryTimezone: true },
      })
      const timezone = sequence?.deliveryTimezone ?? 'UTC'
      const target = computeAnchorTarget(
        newAnchorDate,
        { offsetDays: step.anchorOffsetDays, timeOfDay: step.anchorTimeOfDay },
        timezone
      )

      const jobId = buildWorkflowResumeJobId(run.workflowRunId, workflowRun.pausedNodeId)
      try {
        const existingJob = await workflowDelayQueue.getJob(jobId)
        if (existingJob) await existingJob.remove()
      } catch (error) {
        logger.warn('Failed to remove existing resume job during re-anchor', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (target && !isPastAnchor(target)) {
        await workflowDelayQueue.add(
          'resumeWorkflowJob',
          { workflowRunId: run.workflowRunId, resumeFromNodeId: workflowRun.pausedNodeId },
          {
            delay: target.getTime() - Date.now(),
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            jobId,
          }
        )
      } else {
        try {
          await executionService.resumeWorkflow(run.workflowRunId, workflowRun.pausedNodeId, {
            wait_method: 'reanchor_immediate',
            resumed_at: new Date().toISOString(),
          })
        } catch (error) {
          logger.error('Immediate re-anchor resume failed', {
            workflowRunId: run.workflowRunId,
            error: error instanceof Error ? error.message : String(error),
          })
          continue
        }
      }

      reanchored++
    }

    return ok({ inspected: runs.length, reanchored })
  } catch (error) {
    logger.error('reanchorSequenceRuns failed', {
      organizationId,
      subjectKind,
      subjectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error('reanchorSequenceRuns failed'))
  }
}
