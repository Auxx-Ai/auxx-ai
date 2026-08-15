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

/** Consecutive no-progress slices tolerated before the runner fails a stalled chain
 *  (fails on strike `STALL_STRIKE_LIMIT + 1`). Tiny on purpose — bail within a few
 *  slices, not thousands of pages. */
const STALL_STRIKE_LIMIT = 2

/** Directive returned to the worker after one slice. */
export type SliceOutcome =
  | {
      action: 'reenqueue'
      reason: 'more-pages' | 'retry-held-cursor'
      /** Suggested delay before the next slice — the slice's rate-limit wait, so a
       *  throttled re-enqueue paces (H1) instead of immediately re-hitting the limit. */
      retryAfterMs?: number
    }
  | { action: 'complete'; completedPhase: SyncPhase }
  | { action: 'failed'; error: Error }

export interface RunSliceArgs {
  source: SyncSource
  stateStore: SyncStateStore
  ledger: RunLedger
  /** Built by the worker via `createThrottleHandle(quota)`. */
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

  // A clean advance with no more pages is the EXHAUSTING slice. Clear the cursor —
  // don't fall back to the prior page cursor: that would make the terminal slice's
  // H4 key identical to the penultimate slice's, so its fold would be mistaken for a
  // replay and its counters silently dropped.
  const exhausted = advance && !result.hasMore
  const nextCursor = exhausted
    ? undefined
    : advance
      ? (result.nextCursor ?? state.cursor)
      : state.cursor

  // Stall guard (provider-agnostic backstop — protects app connectors / future channel
  // sync that drive their own pagination, where generic-rest's inner token check can't
  // reach). A full slice that advanced and still claims more, yet moved NOTHING (no
  // records, cursor unchanged), is a stall candidate. One blip (a graceful abort, a
  // transient empty page) is tolerated; STALL_STRIKE_LIMIT+1 consecutive ones fail the
  // run — far cheaper than spinning a continuation chain to the page ceiling.
  const noProgress =
    advance &&
    result.hasMore &&
    result.recordsProcessed === 0 &&
    cursorKey(nextCursor) === cursorKey(state.cursor)
  const strikes = noProgress ? (state.noProgressStrikes ?? 0) + 1 : 0
  if (strikes > STALL_STRIKE_LIMIT) {
    const err = new Error(
      `sync stalled: ${strikes} consecutive slices made no progress ` +
        `(cursor ${cursorKey(state.cursor) ?? 'none'} unchanged) — failing to avoid an infinite chain.`
    )
    logger.error('pagination stalled', {
      sourceId: source.id,
      phase,
      cursor: cursorKey(state.cursor),
      strikes,
    })
    await stateStore.save({ ...state, noProgressStrikes: strikes }) // persist for observability
    await ledger.fail(err)
    return { action: 'failed', error: err }
  }

  const next: SyncState = {
    ...state,
    phase,
    cursor: nextCursor,
    // The source returns a monotonic max watermark; the core just stores it on advance.
    watermark: advance ? (result.watermark ?? state.watermark) : state.watermark,
    recordsSeen: (state.recordsSeen ?? 0) + result.recordsProcessed,
    noProgressStrikes: strikes,
  }

  // Checkpoint AFTER the slice — a crash/restart resumes here, never from page 1.
  await stateStore.save(next)
  // Fold counters + metrics into the run and bump the heartbeat (the stale-sweep
  // keys off this, not start time). Idempotent on the post-slice cursor so a BullMQ
  // job replay that already committed its fold can't double-count (H4). The exhausting
  // slice has no cursor, so it folds under a stable terminal sentinel (per phase). A
  // held cursor (no advance) passes no key — its partial counts always fold.
  const checkpointKey = advance ? (exhausted ? `done:${phase}` : cursorKey(nextCursor)) : undefined
  await ledger.recordSlice({
    counters: result.counters,
    errorSample: result.errorSample,
    pagesProcessed: result.pagesProcessed,
    rateLimitWaitMs: result.rateLimitWaitMs,
    checkpointKey,
  })

  // Transient failure: re-enqueue to retry the held cursor (no ground lost).
  if (result.commit === 'partial-retriable') {
    return {
      action: 'reenqueue',
      reason: 'retry-held-cursor',
      retryAfterMs: result.rateLimitWaitMs,
    }
  }

  // More pages in this phase: re-enqueue the next slice. A made-progress throttle
  // surfaces here as `hasMore` + `rateLimitWaitMs`, so the next slice still paces.
  if (result.hasMore) {
    return { action: 'reenqueue', reason: 'more-pages', retryAfterMs: result.rateLimitWaitMs }
  }

  // Exhausted for this phase. On a finished backfill, run the reconciliation gate
  // ONCE — so a partial backfill never archives unreached records — and only THEN
  // flip to steady. H2: if finalizeBackfill throws, the run fails with phase still
  // 'backfill', so the retry re-runs reconciliation instead of silently skipping it.
  // finalizeBackfill MUST be idempotent.
  if (phase === 'backfill') {
    try {
      await source.finalizeBackfill?.()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('finalizeBackfill failed', { sourceId: source.id, error: err.message })
      await ledger.fail(err)
      return { action: 'failed', error: err }
    }
    await stateStore.save({ ...next, phase: 'steady' })
    // NOTE: the runner does NOT finalize the run on backfill completion. A backfill
    // may span MANY stream chains sharing one run, and only the consumer knows when
    // the LAST one is done — so `finalizeBackfill` owns run finalization for backfill
    // (the DC source finalizes the run + releases the connector on its last stream,
    // gated by the B1 latch). Steady completion below is a single self-contained pass.
  } else {
    await ledger.finalize()
  }
  return { action: 'complete', completedPhase: phase }
}

/** Stable idempotency key for a cursor (H4) — `${kind}:${value}`, or undefined. */
function cursorKey(cursor?: SyncState['cursor']): string | undefined {
  return cursor ? `${cursor.kind}:${cursor.value}` : undefined
}
