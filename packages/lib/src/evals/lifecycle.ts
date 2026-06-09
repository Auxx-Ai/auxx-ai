// packages/lib/src/evals/lifecycle.ts
//
// Run lifecycle transitions: claim, heartbeat, trace checkpoint, terminal
// finalize, cancel, and the stale-run watchdog. Every status-changing update
// carries the expected current status in its WHERE clause so transitions are
// atomic and idempotent (conventions.md §3, §7). Finalizing a run that belongs
// to a suite rolls its counters up in the SAME transaction.
//
// See plans/evals/phase-1-agent-simulation.md §1.3 / §1.9.

import type { EvalRunEntity, Transaction } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import type { AssertionResult, EvalTraceEvent } from '@auxx/types/evals'
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import type { EvalRunErrorCode } from './types'

type TerminalRunStatus = 'passed' | 'failed' | 'error' | 'cancelled' | 'timed_out'

// ── Claim & heartbeat ───────────────────────────────────────────────────

/**
 * Atomically move a run to `running` for the current worker attempt. Claims a
 * fresh `queued` run or re-claims a `running` one (BullMQ retry of the same
 * deterministic job), bumping `attempt`. Returns the claimed row, or `null` when
 * the run is already terminal and must not be reprocessed.
 */
export async function claimEvalRun(input: { runId: string }) {
  const result = await fromDatabase(
    database
      .update(schema.EvalRun)
      .set({
        status: 'running',
        attempt: sql`${schema.EvalRun.attempt} + 1`,
        startedAt: sql`COALESCE(${schema.EvalRun.startedAt}, now())`,
        heartbeatAt: new Date(),
      })
      .where(
        and(
          eq(schema.EvalRun.id, input.runId),
          inArray(schema.EvalRun.status, ['queued', 'running'])
        )
      )
      .returning(),
    'claim-eval-run'
  )
  if (result.isErr()) return err(result.error)
  return ok((result.value[0] ?? null) as EvalRunEntity | null)
}

export async function heartbeatEvalRun(input: { runId: string }) {
  const result = await fromDatabase(
    database
      .update(schema.EvalRun)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(schema.EvalRun.id, input.runId), eq(schema.EvalRun.status, 'running'))),
    'heartbeat-eval-run'
  )
  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

// ── Trace checkpoint ────────────────────────────────────────────────────

/**
 * Append a trace batch and advance `lastTraceSequence` monotonically. Redis is
 * transport; this is the durable checkpoint the SSE route replays from. No-op if
 * the run is no longer `running`.
 */
export async function checkpointEvalTrace(input: {
  runId: string
  events: EvalTraceEvent[]
  lastSequence: number
}) {
  if (input.events.length === 0) return ok(undefined)
  const result = await fromDatabase(
    database
      .update(schema.EvalRun)
      .set({
        trace: sql`COALESCE(${schema.EvalRun.trace}, '[]'::jsonb) || ${JSON.stringify(input.events)}::jsonb`,
        lastTraceSequence: sql`GREATEST(${schema.EvalRun.lastTraceSequence}, ${input.lastSequence})`,
      })
      .where(and(eq(schema.EvalRun.id, input.runId), eq(schema.EvalRun.status, 'running'))),
    'checkpoint-eval-trace'
  )
  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

// ── Terminal transitions ────────────────────────────────────────────────

export interface FinalizeEvalRunInput {
  runId: string
  status: TerminalRunStatus
  assertionResults?: AssertionResult[]
  /** Full trace to flush on completion; omit to keep the checkpointed trace. */
  trace?: EvalTraceEvent[]
  errorCode?: EvalRunErrorCode
  error?: string
}

/**
 * Move a `running` run to a terminal status, flush results, and roll up its
 * suite counters — all transactionally. Idempotent: if the run is already
 * terminal the call is a no-op that returns the current row, so a duplicate
 * BullMQ completion can't double-count a suite.
 */
export async function finalizeEvalRun(input: FinalizeEvalRunInput) {
  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.EvalRun)
        .set({
          status: input.status,
          completedAt: new Date(),
          ...(input.assertionResults
            ? { assertionResults: input.assertionResults as unknown[] }
            : {}),
          ...(input.trace ? { trace: input.trace as unknown[] } : {}),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          ...(input.error ? { error: input.error } : {}),
        })
        .where(and(eq(schema.EvalRun.id, input.runId), eq(schema.EvalRun.status, 'running')))
        .returning()

      if (!updated) {
        // Already terminal (or never running) — idempotent no-op.
        return tx.query.EvalRun.findFirst({ where: eq(schema.EvalRun.id, input.runId) })
      }

      if (updated.suiteRunId) {
        await bumpSuiteCounters(tx, updated.suiteRunId, input.status)
      }
      return updated
    }),
    'finalize-eval-run'
  )
  if (result.isErr()) return err(result.error)
  return ok((result.value ?? null) as EvalRunEntity | null)
}

/**
 * Fail a still-`queued` run that was never claimed — used when `enqueue` fails
 * right after the queued row was inserted (`ENQUEUE_FAILED`). Transitions only
 * from `queued` (a claimed/running run is the worker's to finalize) and rolls the
 * suite `errorCount` up. Idempotent against an already-terminal run.
 */
export async function failQueuedEvalRun(input: {
  runId: string
  errorCode: EvalRunErrorCode
  error: string
}) {
  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.EvalRun)
        .set({
          status: 'error',
          completedAt: new Date(),
          errorCode: input.errorCode,
          error: input.error,
        })
        .where(and(eq(schema.EvalRun.id, input.runId), eq(schema.EvalRun.status, 'queued')))
        .returning()
      if (updated?.suiteRunId) {
        await bumpSuiteCounters(tx, updated.suiteRunId, 'error')
      }
      return updated ?? null
    }),
    'fail-queued-eval-run'
  )
  if (result.isErr()) return err(result.error)
  return ok((result.value ?? null) as EvalRunEntity | null)
}

/**
 * Cancel a run that hasn't finished. Works from `queued` or `running`, and rolls
 * the suite `cancelledCount` up like a normal terminal transition.
 */
export async function cancelEvalRun(input: { organizationId: string; runId: string }) {
  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.EvalRun)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(
          and(
            eq(schema.EvalRun.id, input.runId),
            eq(schema.EvalRun.organizationId, input.organizationId),
            inArray(schema.EvalRun.status, ['queued', 'running'])
          )
        )
        .returning()

      if (!updated) {
        return tx.query.EvalRun.findFirst({
          where: and(
            eq(schema.EvalRun.id, input.runId),
            eq(schema.EvalRun.organizationId, input.organizationId)
          ),
        })
      }
      if (updated.suiteRunId) {
        await bumpSuiteCounters(tx, updated.suiteRunId, 'cancelled')
      }
      return updated
    }),
    'cancel-eval-run'
  )
  if (result.isErr()) return err(result.error)
  return ok((result.value ?? null) as EvalRunEntity | null)
}

/**
 * Watchdog: mark abandoned runs `timed_out` — `running` runs whose heartbeat
 * went stale, or `queued` runs that were never claimed before the deadline.
 * Each is finalized through the suite-counter path. Returns the count timed out.
 */
export async function markStaleEvalRunsTimedOut(input: { olderThan: Date }) {
  const staleResult = await fromDatabase(
    database
      .select({ id: schema.EvalRun.id })
      .from(schema.EvalRun)
      .where(
        or(
          and(
            eq(schema.EvalRun.status, 'running'),
            lt(schema.EvalRun.heartbeatAt, input.olderThan)
          ),
          and(eq(schema.EvalRun.status, 'queued'), lt(schema.EvalRun.createdAt, input.olderThan))
        )
      ),
    'find-stale-eval-runs'
  )
  if (staleResult.isErr()) return err(staleResult.error)

  let timedOut = 0
  for (const { id } of staleResult.value) {
    const r = await fromDatabase(
      database.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.EvalRun)
          .set({
            status: 'timed_out',
            completedAt: new Date(),
            errorCode: 'TIMED_OUT',
            error: 'Run exceeded the heartbeat/queue watchdog deadline',
          })
          .where(
            and(eq(schema.EvalRun.id, id), inArray(schema.EvalRun.status, ['queued', 'running']))
          )
          .returning()
        if (updated?.suiteRunId) {
          await bumpSuiteCounters(tx, updated.suiteRunId, 'timed_out')
        }
        return updated ?? null
      }),
      'timeout-stale-eval-run'
    )
    if (r.isOk() && r.value) timedOut += 1
  }
  return ok(timedOut)
}

// ── helpers ─────────────────────────────────────────────────────────────

/**
 * Increment a suite's `completedCount` + the status-specific counter, and flip
 * the suite to `completed` once every child is terminal. Runs inside the caller's
 * transaction so run finalize + suite roll-up commit atomically.
 */
async function bumpSuiteCounters(tx: Transaction, suiteRunId: string, status: TerminalRunStatus) {
  const t = schema.EvalSuiteRun
  const [suite] = await tx
    .update(t)
    .set({
      completedCount: sql`${t.completedCount} + 1`,
      ...(status === 'passed' ? { passedCount: sql`${t.passedCount} + 1` } : {}),
      ...(status === 'failed' ? { failedCount: sql`${t.failedCount} + 1` } : {}),
      ...(status === 'error' ? { errorCount: sql`${t.errorCount} + 1` } : {}),
      ...(status === 'cancelled' ? { cancelledCount: sql`${t.cancelledCount} + 1` } : {}),
      ...(status === 'timed_out' ? { timedOutCount: sql`${t.timedOutCount} + 1` } : {}),
    })
    .where(eq(t.id, suiteRunId))
    .returning()

  if (suite && suite.completedCount >= suite.requestedCount && suite.status === 'running') {
    await tx
      .update(schema.EvalSuiteRun)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(schema.EvalSuiteRun.id, suiteRunId))
  }
}

export type { EvalRunEntity }
