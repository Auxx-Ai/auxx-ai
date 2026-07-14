// packages/lib/src/sequences/runtime.ts
// Shared exit path for sequence runs (Sequences plan §3.3/Phase 2) — all four exit
// triggers (reply / bounce / unsubscribe / manual) funnel through `exitSequenceRun`
// so `SequenceRun.status`/`exitReason`/`exitMetadata` and the underlying
// `WorkflowRun` stop in lockstep. Also owns the public unsubscribe URL builder
// (mirrors `money/public-token.ts`'s `buildPayUrl`).

import { WEBAPP_URL } from '@auxx/config/urls'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { SystemUserService } from '../users/system-user-service'
import { WorkflowExecutionService } from '../workflows/workflow-execution-service'

const logger = createScopedLogger('sequences-runtime')

export interface ExitSequenceRunParams {
  sequenceRunId: string
  organizationId: string
  reason: 'reply' | 'bounce' | 'unsubscribe' | 'manual'
  metadata?: Record<string, unknown>
  /** Also stop the underlying `WorkflowRun`. Defaults to true. */
  stopWorkflow?: boolean
}

/**
 * Exit a sequence run — the single path all four exit triggers (reply, bounce,
 * unsubscribe, manual) funnel through. Idempotent: exiting a run that's already
 * non-active (completed/exited/failed) is a no-op success, so callers (e.g. the
 * inbound-reply hook racing the send node's own bounce-exit) never double-fire
 * side effects.
 *
 * On a still-active run: marks `SequenceRun` exited with the given reason/
 * metadata, then (unless `stopWorkflow: false`) stops the underlying
 * `WorkflowRun` via the org's system user. `stopWorkflowRun` throws unless the
 * run is currently RUNNING/WAITING — treated as a benign no-op here (the run
 * may already be finishing on its own; the `SequenceRun` row above is the
 * source of truth either way).
 */
export async function exitSequenceRun(
  db: Database,
  params: ExitSequenceRunParams
): Promise<Result<void, Error>> {
  const { sequenceRunId, organizationId, reason, metadata, stopWorkflow = true } = params

  const run = await db.query.SequenceRun.findFirst({
    where: (t, { eq: eqOp, and }) =>
      and(eqOp(t.id, sequenceRunId), eqOp(t.organizationId, organizationId)),
  })

  if (!run) {
    return err(new NotFoundError(`SequenceRun ${sequenceRunId} not found`))
  }

  if (run.status !== 'active') {
    // Already exited/completed/failed — idempotent no-op.
    return ok(undefined)
  }

  await db
    .update(schema.SequenceRun)
    .set({
      status: 'exited',
      exitReason: reason,
      exitMetadata: metadata ?? null,
      exitedAt: new Date(),
    })
    .where(eq(schema.SequenceRun.id, sequenceRunId))

  if (stopWorkflow !== false) {
    try {
      const userId = await SystemUserService.getSystemUserForActions(organizationId)
      const executionService = new WorkflowExecutionService(db)
      await executionService.stopWorkflowRun({
        runId: run.workflowRunId,
        userId,
        organizationId,
      })
    } catch (error) {
      logger.debug('stopWorkflowRun no-op (workflow run likely already finished)', {
        sequenceRunId,
        workflowRunId: run.workflowRunId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return ok(undefined)
}

/** Absolute public unsubscribe URL for a sequence run's stored capability token. */
export function buildSequenceUnsubscribeUrl(unsubscribeToken: string): string {
  return `${WEBAPP_URL}/sequences/unsubscribe/${unsubscribeToken}`
}
