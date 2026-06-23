// packages/lib/src/sync-core/slice-runner.ts
// The core's per-slice orchestrator. Runs exactly ONE slice (= one worker job),
// checkpoints, and returns a directive the worker acts on. The continuation chain
// is the worker re-invoking this on a 'reenqueue' outcome. The core enforces the
// three invariants the plans call for — cursor-safety (advance unless retriable),
// checkpoint-AFTER-slice, reconciliation gated on backfill-complete — and never
// interprets the cursor/watermark or branches on provider.

import { createScopedLogger } from '@auxx/logger'
import type {
  RunLedger,
  SliceBudget,
  SliceResult,
  SyncPhase,
  SyncSliceCtx,
  SyncSource,
  SyncState,
  SyncStateStore,
  ThrottleHandle,
} from './contracts'

const logger = createScopedLogger('sync-core-slice-runner')

/** Directive returned to the worker after one slice. */
export type SliceOutcome =
  | { action: 'reenqueue'; reason: 'more-pages' | 'retry-held-cursor' }
  | { action: 'complete'; completedPhase: SyncPhase }
  | { action: 'failed'; error: Error }

export interface RunSliceArgs {
  source: SyncSource
  stateStore: SyncStateStore
  ledger: RunLedger
  /** Built by the worker via `createThrottleHandle(throttler, source.throttleKey)`. */
  throttle: ThrottleHandle
  budget: SliceBudget
  signal: AbortSignal
}

/**
 * Run one slice of a sync and report what the worker should do next.
 *
 * Outcomes:
 * - `reenqueue` — more work remains (next page, or re-fetch a held cursor after a
 *   transient failure). The worker re-enqueues another slice with the same args.
 * - `complete` — the source is exhausted for this phase. On a finished backfill the
 *   phase has been flipped to `steady` and `finalizeBackfill` (reconciliation) has run.
 * - `failed` — `fetchSlice` threw; the run is closed as failed.
 */
export async function runSyncSlice(args: RunSliceArgs): Promise<SliceOutcome> {
  const { source, stateStore, ledger, throttle, budget, signal } = args

  const state = await stateStore.load()
  const phase: SyncPhase = state.phase ?? 'backfill'

  const ctx: SyncSliceCtx = {
    phase,
    cursor: state.cursor,
    watermark: state.watermark,
    budget,
    throttle,
    signal,
  }

  let result: SliceResult
  try {
    result = await source.fetchSlice(ctx)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('slice failed', { sourceId: source.id, phase, error: err.message })
    await ledger.fail(err)
    return { action: 'failed', error: err }
  }

  // Cursor-safety: advance on a clean slice OR when poison records were skipped past
  // (`partial-permanent`); HOLD only on transient failure (`partial-retriable`) so the
  // next slice re-fetches the same ground. This is the three-state SliceCommit invariant.
  const advance = result.commit !== 'partial-retriable'

  const next: SyncState = {
    ...state,
    phase,
    cursor: advance ? (result.nextCursor ?? state.cursor) : state.cursor,
    // The source returns a monotonic max watermark; the core just stores it on advance.
    watermark: advance ? (result.watermark ?? state.watermark) : state.watermark,
    recordsSeen: (state.recordsSeen ?? 0) + result.recordsProcessed,
  }

  // Checkpoint AFTER the slice — a crash/restart resumes here, never from page 1.
  await stateStore.save(next)
  // Fold counters in and bump the run heartbeat (the stale-sweep keys off this, not start time).
  await ledger.recordSlice(result.counters ?? {})

  // Transient failure: re-enqueue to retry the held cursor (no ground lost).
  if (result.commit === 'partial-retriable') {
    return { action: 'reenqueue', reason: 'retry-held-cursor' }
  }

  // More pages in this phase: re-enqueue the next slice.
  if (result.hasMore) {
    return { action: 'reenqueue', reason: 'more-pages' }
  }

  // Exhausted for this phase. A finished backfill flips to steady and fires the
  // reconciliation gate ONCE — so a partial backfill never archives unreached records.
  if (phase === 'backfill') {
    await stateStore.save({ ...next, phase: 'steady' })
    await source.finalizeBackfill?.()
  }
  await ledger.finalize()
  return { action: 'complete', completedPhase: phase }
}
