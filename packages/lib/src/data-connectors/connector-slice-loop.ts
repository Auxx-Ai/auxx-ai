// packages/lib/src/data-connectors/connector-slice-loop.ts
// The pure slice loop the data-connector `SyncSource` runs — isolated from the
// DB-heavy wiring (crud handler, sink, reconciliation) so it unit-tests with fakes
// (B3) and can't drag server-only deps into a light import. It drains one connector
// page iterable, sinks each record via the injected callback, and stops at the slice
// budget on a PAGE (checkpoint) boundary — never mid-page, never sleeping on a
// throttle. The cursor-safety `commit` and the H1 throttle-yield rule live here.

import type { SliceResult, SyncCursor, SyncSliceCtx } from '../sync-core/contracts'
import {
  ConnectorRateLimitError,
  type ConnectorRecord,
  type FetchResult,
  isConnectorCheckpoint,
} from './connectors/types'
import { maxWatermark } from './watermark'

/** Fetch one (possibly resumed) page stream for a slice. */
export type SliceFetch = (resume: {
  backfillCursor?: SyncCursor
  watermark?: string
}) => Promise<FetchResult>

/** Sink one mapped source record (the connector-agnostic write path). */
export type SliceSink = (record: ConnectorRecord) => Promise<void>

export interface RunConnectorSliceArgs {
  fetch: SliceFetch
  sink: SliceSink
  ctx: SyncSliceCtx
  /** Injectable clock (tests pass a fake to exercise the `maxMs` budget). */
  now: () => number
}

/**
 * Process exactly one bounded slice: drain the connector's page iterable, sinking
 * each record and honoring the slice budget at page (checkpoint) boundaries — never
 * mid-page, never sleeping on a throttle. Returns the `SliceResult` MINUS counters
 * (the caller folds in the sink's counter deltas). The cursor-safety `commit`:
 *   - `all`               — clean slice (exhausted, budget-yield, or a 429 AFTER
 *                           progress: advance + let the next slice re-hit the limit).
 *   - `partial-retriable` — a 429 with zero progress this slice: hold the cursor.
 */
export async function runConnectorSlice(
  args: RunConnectorSliceArgs
): Promise<Omit<SliceResult, 'counters'>> {
  const { fetch, sink, ctx, now } = args
  const started = now()
  let recordsProcessed = 0
  let pages = 0
  let rateLimitWaitMs = 0
  let nextCursor = ctx.cursor
  let watermark = ctx.watermark

  try {
    const { records } = await fetch({ backfillCursor: ctx.cursor, watermark: ctx.watermark })

    for await (const y of records) {
      // Graceful cancellation (cancellable-worker hook) — yield what we have so the
      // chain resumes later instead of failing the run.
      if (ctx.signal.aborted) {
        return {
          recordsProcessed,
          pagesProcessed: pages,
          nextCursor,
          hasMore: true,
          watermark,
          commit: 'all',
          rateLimitWaitMs,
        }
      }

      if (isConnectorCheckpoint(y)) {
        pages += 1
        if (y.watermark) watermark = maxWatermark(watermark, y.watermark)

        // No cursor ⇒ the source is exhausted for this phase.
        if (y.cursor === undefined) {
          return {
            recordsProcessed,
            pagesProcessed: pages,
            nextCursor: undefined,
            hasMore: false,
            watermark,
            commit: 'all',
            rateLimitWaitMs,
          }
        }
        nextCursor = y.cursor

        const budgetHit =
          pages >= ctx.budget.maxPages ||
          recordsProcessed >= ctx.budget.maxRecords ||
          now() - started >= ctx.budget.maxMs
        if (budgetHit) {
          return {
            recordsProcessed,
            pagesProcessed: pages,
            nextCursor,
            hasMore: true,
            watermark,
            commit: 'all',
            rateLimitWaitMs,
          }
        }
        continue
      }

      await sink(y)
      recordsProcessed += 1
    }
  } catch (error) {
    if (error instanceof ConnectorRateLimitError) {
      rateLimitWaitMs += error.retryAfterMs ?? 0
      // Made progress this slice → commit it and advance; the next slice resumes at
      // the last good page and re-hits the limit after the worker's backoff delay.
      if (pages > 0) {
        return {
          recordsProcessed,
          pagesProcessed: pages,
          nextCursor,
          hasMore: true,
          watermark,
          commit: 'all',
          rateLimitWaitMs,
        }
      }
      // Zero progress (throttled on the first page) → hold the cursor, back off.
      return {
        recordsProcessed: 0,
        pagesProcessed: 0,
        hasMore: true,
        watermark,
        commit: 'partial-retriable',
        rateLimitWaitMs,
      }
    }
    // A graceful abort that propagated as a thrown signal is not a real failure.
    if (ctx.signal.aborted) {
      return {
        recordsProcessed,
        pagesProcessed: pages,
        nextCursor,
        hasMore: true,
        watermark,
        commit: 'all',
        rateLimitWaitMs,
      }
    }
    throw error // permanent — the runner closes the run as failed.
  }

  // Generator ended with no terminal checkpoint (fixture/app connectors that don't
  // paginate) → exhausted for this phase.
  return {
    recordsProcessed,
    pagesProcessed: pages,
    nextCursor: undefined,
    hasMore: false,
    watermark,
    commit: 'all',
    rateLimitWaitMs,
  }
}
