// packages/lib/src/sync-core/slice-runner.test.ts
// Pure-unit the per-slice orchestrator against in-memory seam fakes (B3 — no DB
// harness). Covers the three core invariants: cursor-safety (advance unless
// retriable), checkpoint-after-slice, and reconciliation gated BEFORE the steady
// flip (H2).

import { describe, expect, it, vi } from 'vitest'
import type {
  RunLedger,
  SliceBudget,
  SliceLedgerEntry,
  SliceResult,
  SyncSource,
  SyncState,
  SyncStateStore,
  ThrottleHandle,
} from './contracts'
import { runSyncSlice } from './slice-runner'

const BUDGET: SliceBudget = { maxPages: 5, maxRecords: 100, maxMs: 25_000 }
const THROTTLE: ThrottleHandle = { run: (fn) => fn() }

/** A state store backed by a mutable object; records every save. */
function fakeStateStore(initial: SyncState) {
  const saves: SyncState[] = []
  let current = initial
  const store: SyncStateStore = {
    load: async () => current,
    save: async (s) => {
      current = s
      saves.push(s)
    },
  }
  return {
    store,
    saves,
    get current() {
      return current
    },
  }
}

/** A ledger that records its calls. */
function fakeLedger() {
  const slices: SliceLedgerEntry[] = []
  const calls: string[] = []
  const ledger: RunLedger = {
    recordSlice: async (e) => {
      slices.push(e)
      calls.push('recordSlice')
    },
    finalize: async () => {
      calls.push('finalize')
    },
    fail: async () => {
      calls.push('fail')
    },
  }
  return { ledger, slices, calls }
}

function source(over: Partial<SyncSource> & { slice: SliceResult | (() => Promise<SliceResult>) }) {
  const { slice, ...rest } = over
  return {
    id: 'test-source',
    throttleKey: 'conn:op',
    fetchSlice: typeof slice === 'function' ? slice : async () => slice,
    ...rest,
  } satisfies SyncSource
}

describe('runSyncSlice', () => {
  it('advances the cursor and re-enqueues when more pages remain', async () => {
    const state = fakeStateStore({ phase: 'backfill' })
    const ledger = fakeLedger()
    const out = await runSyncSlice({
      source: source({
        slice: {
          recordsProcessed: 50,
          pagesProcessed: 1,
          nextCursor: { kind: 'token', value: 'pg_1' },
          hasMore: true,
          commit: 'all',
          counters: { created: 50 },
        },
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out).toEqual({ action: 'reenqueue', reason: 'more-pages' })
    expect(state.current.cursor).toEqual({ kind: 'token', value: 'pg_1' })
    expect(state.current.recordsSeen).toBe(50)
    // Idempotency key is the serialized advanced cursor.
    expect(ledger.slices[0]?.checkpointKey).toBe('token:pg_1')
    expect(ledger.slices[0]?.counters).toEqual({ created: 50 })
  })

  it('HOLDS the cursor and passes no idempotency key on a transient failure', async () => {
    const state = fakeStateStore({ phase: 'backfill', cursor: { kind: 'token', value: 'pg_3' } })
    const ledger = fakeLedger()
    const out = await runSyncSlice({
      source: source({
        slice: {
          recordsProcessed: 0,
          nextCursor: { kind: 'token', value: 'pg_4' }, // ignored — commit is retriable
          hasMore: true,
          commit: 'partial-retriable',
        },
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out).toEqual({ action: 'reenqueue', reason: 'retry-held-cursor' })
    // Cursor unchanged — the next slice re-fetches the same ground.
    expect(state.current.cursor).toEqual({ kind: 'token', value: 'pg_3' })
    expect(ledger.slices[0]?.checkpointKey).toBeUndefined()
  })

  it('advances past poison records on partial-permanent', async () => {
    const state = fakeStateStore({ phase: 'backfill' })
    const ledger = fakeLedger()
    const out = await runSyncSlice({
      source: source({
        slice: {
          recordsProcessed: 10,
          nextCursor: { kind: 'token', value: 'pg_5' },
          hasMore: true,
          commit: 'partial-permanent',
          counters: { failed: 2, created: 8 },
        },
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out).toEqual({ action: 'reenqueue', reason: 'more-pages' })
    expect(state.current.cursor).toEqual({ kind: 'token', value: 'pg_5' })
    expect(ledger.slices[0]?.checkpointKey).toBe('token:pg_5')
  })

  it('folds the EXHAUSTING slice under a terminal key (not the prior page cursor)', async () => {
    // Regression: on a clean advance-to-exhaustion the source returns no next cursor.
    // The runner must NOT reuse the prior page cursor for the H4 key — that collides
    // with the penultimate slice and drops the terminal slice's counter fold.
    const state = fakeStateStore({ phase: 'backfill', cursor: { kind: 'token', value: 'pg_9' } })
    const ledger = fakeLedger()
    const out = await runSyncSlice({
      source: source({
        slice: { recordsProcessed: 12, hasMore: false, commit: 'all', counters: { created: 12 } },
        finalizeBackfill: vi.fn(async () => {}),
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out).toEqual({ action: 'complete', completedPhase: 'backfill' })
    // Cursor cleared on exhaustion; the fold uses a stable terminal sentinel, NOT
    // 'token:pg_9' (which the penultimate slice already recorded).
    expect(state.current.cursor).toBeUndefined()
    expect(ledger.slices[0]?.checkpointKey).toBe('done:backfill')
    expect(ledger.slices[0]?.counters).toEqual({ created: 12 })
  })

  it('runs finalizeBackfill BEFORE flipping to steady on an exhausted backfill (H2)', async () => {
    const state = fakeStateStore({ phase: 'backfill' })
    const ledger = fakeLedger()
    const order: string[] = []
    const finalizeBackfill = vi.fn(async () => {
      // At the moment reconciliation runs, the phase must still be 'backfill'.
      order.push(`finalize:${state.current.phase}`)
    })

    const out = await runSyncSlice({
      source: source({
        slice: { recordsProcessed: 5, hasMore: false, commit: 'all' },
        finalizeBackfill,
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out).toEqual({ action: 'complete', completedPhase: 'backfill' })
    expect(finalizeBackfill).toHaveBeenCalledOnce()
    expect(order).toEqual(['finalize:backfill']) // reconciled while still backfill
    expect(state.current.phase).toBe('steady') // …then flipped
    // Backfill run finalization is DELEGATED to finalizeBackfill (multi-stream
    // coordination), so the runner itself does NOT call ledger.finalize here.
    expect(ledger.calls).not.toContain('finalize')
  })

  it('finalizes the run directly on a steady-phase completion (single pass)', async () => {
    const state = fakeStateStore({ phase: 'steady' })
    const ledger = fakeLedger()
    const finalizeBackfill = vi.fn(async () => {})
    const out = await runSyncSlice({
      source: source({
        slice: { recordsProcessed: 3, hasMore: false, commit: 'all' },
        finalizeBackfill,
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out).toEqual({ action: 'complete', completedPhase: 'steady' })
    // Steady is a self-contained pass — the runner finalizes, and the backfill-only
    // reconciliation hook never fires.
    expect(finalizeBackfill).not.toHaveBeenCalled()
    expect(ledger.calls).toContain('finalize')
  })

  it('does NOT flip to steady when finalizeBackfill throws (H2 — retry re-reconciles)', async () => {
    const state = fakeStateStore({ phase: 'backfill' })
    const ledger = fakeLedger()
    const out = await runSyncSlice({
      source: source({
        slice: { recordsProcessed: 5, hasMore: false, commit: 'all' },
        finalizeBackfill: async () => {
          throw new Error('reconcile boom')
        },
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out.action).toBe('failed')
    // Phase stays 'backfill' so the next run re-runs reconciliation.
    expect(state.current.phase).toBe('backfill')
    expect(ledger.calls).toContain('fail')
    expect(ledger.calls).not.toContain('finalize')
  })

  it('fails the run when fetchSlice throws', async () => {
    const state = fakeStateStore({ phase: 'backfill' })
    const ledger = fakeLedger()
    const out = await runSyncSlice({
      source: source({
        slice: async () => {
          throw new Error('fetch boom')
        },
      }),
      stateStore: state.store,
      ledger: ledger.ledger,
      throttle: THROTTLE,
      budget: BUDGET,
      signal: new AbortController().signal,
    })

    expect(out.action).toBe('failed')
    expect(ledger.calls).toEqual(['fail'])
    expect(state.saves).toHaveLength(0) // nothing checkpointed
  })
})
