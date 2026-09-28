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

/** Sink one page of source records together (`sinkSourcePage`). */
export type SlicePageSink = (records: ConnectorRecord[]) => Promise<void>

/** A page sinks at its checkpoint, or at this many records when a source pages larger or not at all. */
export const SINK_PAGE_MAX_RECORDS = 100

export interface RunConnectorSliceArgs {
  fetch: SliceFetch
  sink: SliceSink
  /** When set, records are buffered and sunk a page at a time instead of through `sink`. */
  sinkPage?: SlicePageSink
  ctx: SyncSliceCtx
  /** Injectable clock (tests pass a fake to exercise the `maxMs` budget). */
  now: () => number
  /**
   * Consulted at page boundaries so a user pause never loses half a page. `'complete'` ends
   * the phase here: the slice reports exhausted with `pendingSince` as its watermark.
   */
  shouldStop?: (page: {
    recordsProcessed: number
    pendingSince?: string
  }) => Promise<boolean | 'complete'>
}

/**
 * Process exactly one bounded slice: drain the connector's page iterable, sinking
 * each record and honoring the slice budget at page (checkpoint) boundaries — never
 * mid-page, never sleeping on a throttle. Returns the `SliceResult` whose `counters`
 * carry only `fetchMs`/`sinkMs` (the caller merges in the sink's counter deltas).
 * The cursor-safety `commit`:
 *   - `all`               — clean slice (exhausted, budget-yield, or a 429 AFTER
 *                           progress: advance + let the next slice re-hit the limit).
 *   - `partial-retriable` — a 429 with zero progress this slice: hold the cursor.
 */
export async function runConnectorSlice(args: RunConnectorSliceArgs): Promise<SliceResult> {
  const { fetch, sink, ctx, now } = args
  const started = now()
  // `mark` is when the current fetch wait began; page bookkeeping between them is neither.
  let mark = started
  let fetchMs = 0
  let sinkMs = 0
  const done = (r: Omit<SliceResult, 'counters'>): SliceResult => ({
    pendingSince,
    ...r,
    counters: { fetchMs, sinkMs },
  })
  let recordsProcessed = 0
  let pages = 0
  let rateLimitWaitMs = 0
  let nextCursor = ctx.cursor
  let watermark = ctx.watermark
  let pendingSince = ctx.pendingSince
  // Records of the current page not yet sunk; an abort or a 429 drops them with the page.
  let buffer: ConnectorRecord[] = []
  const timedSink = async (write: () => Promise<void>) => {
    const sinkStart = now()
    try {
      await write()
    } finally {
      mark = now()
      sinkMs += mark - sinkStart
    }
  }
  const drain = async () => {
    if (!args.sinkPage || buffer.length === 0) return
    const page = buffer
    buffer = []
    await timedSink(() => args.sinkPage!(page))
    recordsProcessed += page.length
  }

  try {
    const { records } = await fetch({ backfillCursor: ctx.cursor, watermark: ctx.watermark })

    for await (const y of records) {
      fetchMs += now() - mark
      // Graceful cancellation (cancellable-worker hook) — yield what we have so the
      // chain resumes later instead of failing the run.
      if (ctx.signal.aborted) {
        return done({
          recordsProcessed,
          pagesProcessed: pages,
          nextCursor,
          hasMore: true,
          watermark,
          commit: 'all',
          rateLimitWaitMs,
        })
      }

      if (isConnectorCheckpoint(y)) {
        await drain()
        pages += 1
        // A generic-REST watermark is a comparable max; an app's `since` is opaque and replaces.
        if (y.watermark) watermark = maxWatermark(watermark, y.watermark)

        // No cursor ⇒ the source is exhausted for this phase.
        if (y.cursor === undefined) {
          if (y.since !== undefined) watermark = y.since
          return done({
            recordsProcessed,
            pagesProcessed: pages,
            nextCursor: undefined,
            hasMore: false,
            watermark,
            pendingSince: undefined,
            commit: 'all',
            rateLimitWaitMs,
          })
        }
        nextCursor = y.cursor
        // A mid-crawl `since` is provisional: a backfill keeps it for an early stop; a steady
        // delta that dies half-way must repeat from its old watermark, so it is ignored.
        if (y.since !== undefined && ctx.phase === 'backfill') pendingSince = y.since

        const stop = await args.shouldStop?.({ recordsProcessed, pendingSince })
        if (stop === 'complete') {
          return done({
            recordsProcessed,
            pagesProcessed: pages,
            nextCursor: undefined,
            hasMore: false,
            watermark: pendingSince,
            pendingSince: undefined,
            commit: 'all',
            rateLimitWaitMs,
          })
        }
        const budgetHit =
          pages >= ctx.budget.maxPages ||
          recordsProcessed >= ctx.budget.maxRecords ||
          now() - started >= ctx.budget.maxMs
        if (budgetHit || stop) {
          return done({
            recordsProcessed,
            pagesProcessed: pages,
            nextCursor,
            hasMore: true,
            watermark,
            commit: 'all',
            rateLimitWaitMs,
          })
        }
        mark = now()
        continue
      }

      if (args.sinkPage) {
        buffer.push(y)
        if (buffer.length >= SINK_PAGE_MAX_RECORDS) await drain()
        else mark = now()
        continue
      }
      await timedSink(() => sink(y))
      recordsProcessed += 1
    }
    await drain()
  } catch (error) {
    // The wait that threw (a 429, an abort) was fetch time; after a sink throw this adds ~0.
    fetchMs += now() - mark
    if (error instanceof ConnectorRateLimitError) {
      rateLimitWaitMs += error.retryAfterMs ?? 0
      // Made progress this slice → commit it and advance; the next slice resumes at
      // the last good page and re-hits the limit after the worker's backoff delay.
      if (pages > 0) {
        return done({
          recordsProcessed,
          pagesProcessed: pages,
          nextCursor,
          hasMore: true,
          watermark,
          commit: 'all',
          rateLimitWaitMs,
        })
      }
      // Zero progress (throttled on the first page) → hold the cursor, back off.
      return done({
        recordsProcessed: 0,
        pagesProcessed: 0,
        hasMore: true,
        watermark,
        commit: 'partial-retriable',
        rateLimitWaitMs,
      })
    }
    // A graceful abort that propagated as a thrown signal is not a real failure.
    if (ctx.signal.aborted) {
      return done({
        recordsProcessed,
        pagesProcessed: pages,
        nextCursor,
        hasMore: true,
        watermark,
        commit: 'all',
        rateLimitWaitMs,
      })
    }
    throw error // permanent — the runner closes the run as failed.
  }

  // Generator ended with no terminal checkpoint (fixture/app connectors that don't
  // paginate) → exhausted for this phase.
  return done({
    recordsProcessed,
    pagesProcessed: pages,
    nextCursor: undefined,
    hasMore: false,
    watermark,
    commit: 'all',
    rateLimitWaitMs,
  })
}
