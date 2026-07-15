// packages/lib/src/sequences/runtime.ts
// Shared exit path for sequence runs (Sequences plan §3.3/Phase 2) — all four exit
// triggers (reply / bounce / unsubscribe / manual) funnel through `exitSequenceRun`
// so `SequenceRun.status`/`exitReason`/`exitMetadata` and the underlying
// `WorkflowRun` stop in lockstep. Also owns the public unsubscribe URL builder
// (mirrors `money/public-token.ts`'s `buildPayUrl`).

import { WEBAPP_URL } from '@auxx/config/urls'
import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { SystemUserService } from '../users/system-user-service'
import { WorkflowExecutionService } from '../workflows/workflow-execution-service'
import type { SequenceExitReason } from './client'

const logger = createScopedLogger('sequences-runtime')

export interface ExitSequenceRunParams {
  sequenceRunId: string
  organizationId: string
  reason: SequenceExitReason
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

export interface ExitActiveRunsResult {
  /** Number of active runs that were exited. */
  exited: number
}

/**
 * Bulk-exit every active run of a sequence (client-notifications plan §4.3/§4.7 decision #11
 * — turning off an event-triggered sequence exits its in-flight runs with reason `'disabled'`;
 * a later phase's "disable sequence" settings action is the sole caller). Thin loop over the
 * existing `exitSequenceRun` choke point — no bulk SQL shortcut, so each run still stops its
 * own `WorkflowRun` and gets the same idempotency guarantee as every other exit trigger.
 */
export async function exitActiveRunsForSequence(
  organizationId: string,
  sequenceId: string,
  reason: SequenceExitReason
): Promise<Result<ExitActiveRunsResult, Error>> {
  const runs = await database.query.SequenceRun.findMany({
    where: and(
      eq(schema.SequenceRun.organizationId, organizationId),
      eq(schema.SequenceRun.sequenceId, sequenceId),
      eq(schema.SequenceRun.status, 'active')
    ),
    columns: { id: true },
  })

  let exited = 0
  for (const run of runs) {
    const result = await exitSequenceRun(database, {
      sequenceRunId: run.id,
      organizationId,
      reason,
    })
    if (result.isOk()) exited++
    else {
      logger.error('Failed to exit run during bulk sequence exit', {
        sequenceId,
        sequenceRunId: run.id,
        error: result.error.message,
      })
    }
  }

  return ok({ exited })
}
