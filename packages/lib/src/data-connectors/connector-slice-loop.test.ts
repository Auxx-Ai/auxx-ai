// packages/lib/src/data-connectors/connector-slice-loop.test.ts
// Pure-unit coverage of the slice loop (B3) — budget bounding, exhaustion, and the
// H1 throttle-yield matrix — driven by fake fetch/sink callbacks, no DB.

import { describe, expect, it, vi } from 'vitest'
import type { SliceBudget, SyncSliceCtx } from '../sync-core/contracts'
import { runConnectorSlice } from './connector-slice-loop'
import {
  ConnectorRateLimitError,
  type ConnectorYield,
  PaginationStalledError,
} from './connectors/types'

const BIG_BUDGET: SliceBudget = { maxPages: 1_000, maxRecords: 1_000_000, maxMs: 1_000_000 }

function rec(id: string): ConnectorYield {
  return { streamKey: 's1', fields: { id } }
}
function checkpoint(value?: string, watermark?: string): ConnectorYield {
  return value === undefined
    ? { __checkpoint: true, ...(watermark ? { watermark } : {}) }
    : { __checkpoint: true, cursor: { kind: 'token', value }, ...(watermark ? { watermark } : {}) }
}

/** Build a fetch that yields the given sequence; optionally throws at the end. */
function fakeFetch(seq: ConnectorYield[], throwAtEnd?: Error) {
  return async () => ({
    nextState: {},
    records: (async function* () {
      for (const y of seq) yield y
      if (throwAtEnd) throw throwAtEnd
    })(),
  })
}

function ctx(over: Partial<SyncSliceCtx> = {}): SyncSliceCtx {
  return {
    phase: 'backfill',
    budget: BIG_BUDGET,
    throttle: { run: (fn) => fn() },
    signal: new AbortController().signal,
    ...over,
  }
}

describe('runConnectorSlice', () => {
  it('drains to exhaustion: counts records + pages, no more', async () => {
    const sink = vi.fn(async () => {})
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), checkpoint('c1'), rec('b'), checkpoint(undefined)]),
      sink,
      ctx: ctx(),
      now: () => 0,
    })
    expect(result).toMatchObject({
      recordsProcessed: 2,
      pagesProcessed: 2,
      hasMore: false,
      commit: 'all',
      nextCursor: undefined,
    })
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('yields at the maxPages budget with the resume cursor', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), checkpoint('c1'), rec('b'), checkpoint('c2'), rec('c')]),
      sink: async () => {},
      ctx: ctx({ budget: { ...BIG_BUDGET, maxPages: 1 } }),
      now: () => 0,
    })
    expect(result).toMatchObject({
      recordsProcessed: 1,
      pagesProcessed: 1,
      hasMore: true,
      commit: 'all',
      nextCursor: { kind: 'token', value: 'c1' },
    })
  })

  it('bounds on maxRecords at the page boundary (never mid-page)', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), rec('b'), rec('c'), checkpoint('c1'), rec('d')]),
      sink: async () => {},
      ctx: ctx({ budget: { ...BIG_BUDGET, maxRecords: 2 } }),
      now: () => 0,
    })
    // All 3 records of the page are sunk before the boundary check fires.
    expect(result).toMatchObject({ recordsProcessed: 3, hasMore: true, commit: 'all' })
  })

  it('bounds on maxMs using the injected clock', async () => {
    const now = vi.fn()
    now.mockReturnValueOnce(0) // started
    now.mockReturnValue(50) // every budget check
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), checkpoint('c1'), rec('b'), checkpoint('c2')]),
      sink: async () => {},
      ctx: ctx({ budget: { ...BIG_BUDGET, maxMs: 10 } }),
      now,
    })
    expect(result).toMatchObject({ hasMore: true, nextCursor: { kind: 'token', value: 'c1' } })
  })

  it('tracks the max watermark across checkpoints', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch([
        rec('a'),
        checkpoint('c1', '2026-01-01'),
        rec('b'),
        checkpoint(undefined, '2026-03-01'),
      ]),
      sink: async () => {},
      ctx: ctx(),
      now: () => 0,
    })
    expect(result.watermark).toBe('2026-03-01')
  })

  it('H1: a 429 AFTER progress commits the slice and advances (hasMore)', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch(
        [rec('a'), checkpoint('c1'), rec('b')],
        new ConnectorRateLimitError('throttled', 5_000)
      ),
      sink: async () => {},
      ctx: ctx(),
      now: () => 0,
    })
    expect(result).toMatchObject({
      recordsProcessed: 2,
      hasMore: true,
      commit: 'all',
      nextCursor: { kind: 'token', value: 'c1' },
      rateLimitWaitMs: 5_000,
    })
  })

  it('H1: a 429 with ZERO progress holds the cursor (partial-retriable)', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a')], new ConnectorRateLimitError('throttled', 3_000)),
      sink: async () => {},
      ctx: ctx({ cursor: { kind: 'token', value: 'start' } }),
      now: () => 0,
    })
    expect(result).toMatchObject({
      recordsProcessed: 0,
      hasMore: true,
      commit: 'partial-retriable',
      rateLimitWaitMs: 3_000,
    })
    // nextCursor omitted → the runner holds at ctx.cursor.
    expect(result.nextCursor).toBeUndefined()
  })

  it('a non-checkpointing connector (fixture-like) exhausts in one slice', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), rec('b'), rec('c')]),
      sink: async () => {},
      ctx: ctx(),
      now: () => 0,
    })
    expect(result).toMatchObject({ recordsProcessed: 3, pagesProcessed: 0, hasMore: false })
  })

  it('rethrows a permanent (non-rate-limit) error to fail the run', async () => {
    await expect(
      runConnectorSlice({
        fetch: fakeFetch([rec('a')], new Error('boom')),
        sink: async () => {},
        ctx: ctx(),
        now: () => 0,
      })
    ).rejects.toThrow('boom')
  })

  it('propagates a PaginationStalledError (not swallowed like a rate-limit/abort)', async () => {
    // A non-advancing-cursor stall is permanent — it must surface to fail the run, not
    // get treated as a retriable throttle.
    await expect(
      runConnectorSlice({
        fetch: fakeFetch([rec('a'), checkpoint('c1')], new PaginationStalledError('stuck')),
        sink: async () => {},
        ctx: ctx(),
        now: () => 0,
      })
    ).rejects.toBeInstanceOf(PaginationStalledError)
  })

  it('a cancelled signal yields gracefully (not a failure)', async () => {
    const controller = new AbortController()
    controller.abort()
    const sink = vi.fn(async () => {})
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), checkpoint('c1')]),
      sink,
      ctx: ctx({ signal: controller.signal, cursor: { kind: 'token', value: 'start' } }),
      now: () => 0,
    })
    expect(result).toMatchObject({ hasMore: true, commit: 'all' })
    expect(sink).not.toHaveBeenCalled()
  })
})
