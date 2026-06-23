// packages/lib/src/data-connectors/async-export/slice-loop.ts
// The provider-neutral async-export slice state machine (Step 7 / large-dataset §5.1).
// One call = ONE slice = one worker job. A slice does exactly one phase of the async
// job and returns a `SliceResult` the core runner acts on — the continuation chain is
// the worker re-enqueueing on `hasMore`. Crucially, a poll slice does NO record work
// and returns immediately (with a poll-delay), so "wait for the export to finish" never
// holds a worker lock: it's spread across many tiny re-enqueued slices.
//
//   init      → kick off the job, checkpoint the handle, re-enqueue to poll.
//   poll      → running ⇒ re-enqueue (capped backoff); completed ⇒ move to download;
//               failed/expired ⇒ re-initiate (bounded) or fail the run.
//   download  → stream the (already-restitched) records into the sink, then complete.
//
// Pure over an injected driver + sink + clock, so it unit-tests with fakes (no network).

import type { SliceResult, SyncSliceCtx } from '../../sync-core/contracts'
import type { SliceSink } from '../connector-slice-loop'
import type { AsyncExportDriver } from './types'
import {
  type AsyncExportState,
  decodeAsyncCursor,
  encodeAsyncCursor,
  MAX_REINITIATE,
  pollDelayMs,
} from './types'

export interface RunAsyncExportSliceArgs {
  driver: AsyncExportDriver
  sink: SliceSink
  ctx: SyncSliceCtx
}

/** A re-enqueue slice result that advances to `next` after `delayMs`, doing no record work. */
function step(next: AsyncExportState, delayMs: number): Omit<SliceResult, 'counters'> {
  return {
    recordsProcessed: 0,
    pagesProcessed: 0,
    nextCursor: encodeAsyncCursor(next),
    hasMore: true,
    // The core surfaces `rateLimitWaitMs` as the re-enqueue delay (retryAfterMs). For an
    // async export it's not a throttle wait but the poll/stage pacing — same channel.
    rateLimitWaitMs: delayMs,
    commit: 'all',
  }
}

/**
 * Run one async-export slice. Returns the `SliceResult` MINUS counters (the caller folds
 * the sink's counter deltas, mirroring `runConnectorSlice`).
 */
export async function runAsyncExportSlice(
  args: RunAsyncExportSliceArgs
): Promise<Omit<SliceResult, 'counters'>> {
  const { driver, sink, ctx } = args
  const state = decodeAsyncCursor(ctx.cursor)

  if (state.stage === 'init') {
    const { handle } = await driver.initiate()
    return step({ stage: 'poll', handle, polls: 0 }, pollDelayMs(0))
  }

  if (state.stage === 'poll') {
    if (!state.handle) {
      // Lost handle (shouldn't happen) — restart the job rather than poll nothing.
      return step({ stage: 'init', attempts: state.attempts }, 0)
    }
    const status = await driver.poll(state.handle)

    if (status.state === 'running') {
      const polls = (state.polls ?? 0) + 1
      return step({ ...state, polls }, pollDelayMs(polls))
    }
    if (status.state === 'completed') {
      // Move to download on the next slice (don't chain a multi-minute download onto a
      // poll slice). No delay — the file is ready.
      return step({ stage: 'download', url: status.url }, 0)
    }
    // failed / expired → re-initiate, bounded. Past the budget, fail the run permanently.
    const attempts = (state.attempts ?? 0) + 1
    if (attempts > MAX_REINITIATE) {
      const why = status.state === 'failed' ? (status.reason ?? 'failed') : 'result url expired'
      throw new Error(
        `async-export ${driver.id}: giving up after ${MAX_REINITIATE} re-initiates (${why})`
      )
    }
    return step({ stage: 'init', attempts }, 0)
  }

  // download
  if (!state.url) {
    // Lost url — re-initiate rather than download nothing.
    return step({ stage: 'init', attempts: state.attempts }, 0)
  }
  let recordsProcessed = 0
  for await (const record of driver.download(state.url)) {
    if (ctx.signal.aborted) {
      // Graceful cancellation — re-enqueue the download. The signed URL re-fetches from
      // the top; the sink dedupes already-written records on their content hash, so the
      // re-download is idempotent (counters may slightly over-count fetched/skipped).
      return {
        recordsProcessed,
        nextCursor: encodeAsyncCursor(state),
        hasMore: true,
        commit: 'all',
        rateLimitWaitMs: 0,
      }
    }
    await sink(record)
    recordsProcessed += 1
  }
  // The whole file streamed — this phase is exhausted (the runner runs reconciliation
  // and flips to steady). The budget is advisory here: restitch needs the full file, so
  // a download isn't split mid-stream in v1 (resumable download deferred to Step 7b+).
  return { recordsProcessed, nextCursor: undefined, hasMore: false, commit: 'all' }
}
