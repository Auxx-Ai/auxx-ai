// packages/lib/src/data-connectors/__tests__/connector-slice-loop.test.ts
// Pure-unit coverage of the slice loop (B3) — budget bounding, exhaustion, and the
// H1 throttle-yield matrix — driven by fake fetch/sink callbacks, no DB.

import { describe, expect, it, vi } from 'vitest'
import type { SliceBudget, SyncSliceCtx } from '../../sync-core/contracts'
import { runConnectorSlice, SINK_PAGE_MAX_RECORDS } from '../connector-slice-loop'
import {
  ConnectorRateLimitError,
  type ConnectorYield,
  PaginationStalledError,
} from '../connectors/types'

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
  it('finishes the current page after a pause, saves its cursor, and does not fetch the next page', async () => {
    let paused = false
    const nextPage = vi.fn()
    const sink = vi.fn(async () => {
      paused = true
    })
    const result = await runConnectorSlice({
      fetch: async () => ({
        records: (async function* () {
          yield rec('a')
          yield rec('b')
          yield checkpoint('page-2', 'W2')
          nextPage()
          yield rec('c')
        })(),
      }),
      sink,
      ctx: ctx(),
      now: () => 0,
      shouldStop: async () => paused,
    })
    expect(sink).toHaveBeenCalledTimes(2)
    expect(nextPage).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      recordsProcessed: 2,
      pagesProcessed: 1,
      nextCursor: { kind: 'token', value: 'page-2' },
      watermark: 'W2',
      hasMore: true,
      commit: 'all',
    })
  })
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

  it('never lowers an inbound watermark with a smaller generic-REST max', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), checkpoint(undefined, '2026-01-01')]),
      sink: async () => {},
      ctx: ctx({ phase: 'steady', watermark: '2026-05-01' }),
      now: () => 0,
    })
    expect(result.watermark).toBe('2026-05-01')
  })

  it('replaces the inbound watermark with an app since, even a "smaller" one', async () => {
    const result = await runConnectorSlice({
      fetch: fakeFetch([rec('a'), { __checkpoint: true, since: '"aaa"' }]),
      sink: async () => {},
      ctx: ctx({ phase: 'steady', watermark: '"zzz"' }),
      now: () => 0,
    })
    expect(result.watermark).toBe('"aaa"')
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

  describe('fetch vs sink timing', () => {
    /** A clock the fake fetch and sink advance by hand: each yield costs 100, each sink 30. */
    function timedSlice(seq: ConnectorYield[], throwAtEnd?: Error) {
      let t = 0
      return {
        now: () => t,
        fetch: async () => ({
          records: (async function* () {
            for (const y of seq) {
              t += 100
              yield y
            }
            if (throwAtEnd) {
              t += 100
              throw throwAtEnd
            }
          })(),
        }),
        sink: async () => {
          t += 30
        },
        // Page bookkeeping between yields is neither fetch nor sink.
        shouldStop: async () => {
          t += 7
          return false
        },
      }
    }

    it('splits the iterator waits from the sink calls', async () => {
      const result = await runConnectorSlice({
        ...timedSlice([rec('a'), checkpoint('c1'), rec('b'), rec('c'), checkpoint()]),
        ctx: ctx(),
      })
      expect(result.counters).toEqual({ fetchMs: 500, sinkMs: 90 })
    })

    it('counts the wait that threw a 429 as fetch time', async () => {
      const result = await runConnectorSlice({
        ...timedSlice([rec('a'), checkpoint('c1')], new ConnectorRateLimitError('slow down', 0)),
        ctx: ctx(),
      })
      expect(result.commit).toBe('all')
      expect(result.counters).toEqual({ fetchMs: 300, sinkMs: 30 })
    })
  })

  describe('page sink', () => {
    it('sinks each page once at its checkpoint, in order', async () => {
      const pages: string[][] = []
      const sink = vi.fn(async () => {})
      const result = await runConnectorSlice({
        fetch: fakeFetch([rec('a'), rec('b'), checkpoint('c1'), rec('c'), checkpoint(undefined)]),
        sink,
        sinkPage: async (records) => {
          pages.push(records.map((r) => (r.fields as { id: string }).id))
        },
        ctx: ctx(),
        now: () => 0,
      })
      expect(pages).toEqual([['a', 'b'], ['c']])
      expect(sink).not.toHaveBeenCalled()
      expect(result).toMatchObject({ recordsProcessed: 3, pagesProcessed: 2, hasMore: false })
    })

    it('drains the tail of a source that ends without a checkpoint', async () => {
      const pages: number[] = []
      const result = await runConnectorSlice({
        fetch: fakeFetch([rec('a'), rec('b')]),
        sink: async () => {},
        sinkPage: async (records) => {
          pages.push(records.length)
        },
        ctx: ctx(),
        now: () => 0,
      })
      expect(pages).toEqual([2])
      expect(result.recordsProcessed).toBe(2)
    })

    it('splits a page larger than SINK_PAGE_MAX_RECORDS', async () => {
      const pages: number[] = []
      const seq = Array.from({ length: SINK_PAGE_MAX_RECORDS + 1 }, (_, i) => rec(`r${i}`))
      await runConnectorSlice({
        fetch: fakeFetch([...seq, checkpoint(undefined)]),
        sink: async () => {},
        sinkPage: async (records) => {
          pages.push(records.length)
        },
        ctx: ctx(),
        now: () => 0,
      })
      expect(pages).toEqual([SINK_PAGE_MAX_RECORDS, 1])
    })

    it('drops a half-read page on a 429 and resumes from the last checkpoint', async () => {
      const pages: string[][] = []
      const result = await runConnectorSlice({
        fetch: fakeFetch(
          [rec('a'), checkpoint('c1'), rec('b')],
          new ConnectorRateLimitError('slow down', 0)
        ),
        sink: async () => {},
        sinkPage: async (records) => {
          pages.push(records.map((r) => (r.fields as { id: string }).id))
        },
        ctx: ctx(),
        now: () => 0,
      })
      expect(pages).toEqual([['a']])
      expect(result).toMatchObject({
        recordsProcessed: 1,
        nextCursor: { kind: 'token', value: 'c1' },
        commit: 'all',
      })
    })

    it('times the page sink as sink time and the waits as fetch time', async () => {
      let t = 0
      const result = await runConnectorSlice({
        fetch: async () => ({
          records: (async function* () {
            for (const y of [rec('a'), rec('b'), checkpoint()]) {
              t += 100
              yield y
            }
          })(),
        }),
        sink: async () => {},
        sinkPage: async () => {
          t += 30
        },
        ctx: ctx(),
        now: () => t,
      })
      expect(result.counters).toEqual({ fetchMs: 300, sinkMs: 30 })
    })
  })
})
