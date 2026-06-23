// packages/lib/src/data-connectors/async-export/slice-loop.test.ts
// The async-export slice state machine (init → poll → download), driven by a fake
// driver + in-memory sink. One runAsyncExportSlice call = one slice; we thread the
// returned nextCursor into the next call to simulate the worker's continuation chain.

import { describe, expect, it, vi } from 'vitest'
import type { SyncCursor, SyncSliceCtx, ThrottleHandle } from '../../sync-core/contracts'
import type { ConnectorRecord } from '../connectors/types'
import { runAsyncExportSlice } from './slice-loop'
import { type AsyncExportDriver, type AsyncExportStatus, decodeAsyncCursor } from './types'

function ctx(cursor?: SyncCursor, aborted = false): SyncSliceCtx {
  const ac = new AbortController()
  if (aborted) ac.abort()
  return {
    phase: 'backfill',
    cursor,
    budget: { maxPages: 20, maxRecords: 5_000, maxMs: 25_000 },
    throttle: {} as ThrottleHandle,
    signal: ac.signal,
  }
}

function rec(id: string): ConnectorRecord {
  return { streamKey: 's1', fields: { id }, externalId: id }
}

/** A driver whose poll() walks a scripted status sequence; download() yields fixed records. */
function fakeDriver(opts: {
  statuses?: AsyncExportStatus[]
  records?: ConnectorRecord[]
  onDownload?: () => void
}): AsyncExportDriver & { initiated: number; polled: number } {
  const statuses = [...(opts.statuses ?? [])]
  const d = {
    id: 'fake',
    initiated: 0,
    polled: 0,
    async initiate() {
      d.initiated += 1
      return { handle: `op${d.initiated}` }
    },
    async poll() {
      d.polled += 1
      return statuses.shift() ?? { state: 'running' as const }
    },
    async *download() {
      opts.onDownload?.()
      for (const r of opts.records ?? []) yield r
    },
  }
  return d
}

describe('runAsyncExportSlice', () => {
  it('runs the full lifecycle init → poll(running) → poll(completed) → download', async () => {
    const driver = fakeDriver({
      statuses: [{ state: 'running' }, { state: 'completed', url: 'https://x/file.jsonl' }],
      records: [rec('a'), rec('b')],
    })
    const sunk: ConnectorRecord[] = []
    const sink = (r: ConnectorRecord) => {
      sunk.push(r)
      return Promise.resolve()
    }

    // Slice 1 — initiate.
    const s1 = await runAsyncExportSlice({ driver, sink, ctx: ctx() })
    expect(driver.initiated).toBe(1)
    expect(s1.hasMore).toBe(true)
    expect(s1.recordsProcessed).toBe(0)
    expect(s1.rateLimitWaitMs).toBe(5_000)
    expect(decodeAsyncCursor(s1.nextCursor)).toMatchObject({
      stage: 'poll',
      handle: 'op1',
      polls: 0,
    })

    // Slice 2 — poll, still running → backed-off re-enqueue.
    const s2 = await runAsyncExportSlice({ driver, sink, ctx: ctx(s1.nextCursor) })
    expect(s2.hasMore).toBe(true)
    expect(s2.rateLimitWaitMs).toBe(10_000)
    expect(decodeAsyncCursor(s2.nextCursor)).toMatchObject({ stage: 'poll', polls: 1 })

    // Slice 3 — poll, completed → move to download (no delay).
    const s3 = await runAsyncExportSlice({ driver, sink, ctx: ctx(s2.nextCursor) })
    expect(s3.hasMore).toBe(true)
    expect(s3.rateLimitWaitMs).toBe(0)
    expect(decodeAsyncCursor(s3.nextCursor)).toMatchObject({
      stage: 'download',
      url: 'https://x/file.jsonl',
    })
    expect(sunk).toHaveLength(0) // download hasn't run yet

    // Slice 4 — download → sink all, exhausted.
    const s4 = await runAsyncExportSlice({ driver, sink, ctx: ctx(s3.nextCursor) })
    expect(sunk.map((r) => r.externalId)).toEqual(['a', 'b'])
    expect(s4.recordsProcessed).toBe(2)
    expect(s4.hasMore).toBe(false)
    expect(s4.nextCursor).toBeUndefined()
  })

  it('re-initiates a FAILED job (bounded), keeping an attempt count', async () => {
    const driver = fakeDriver({ statuses: [{ state: 'failed', reason: 'boom' }] })
    const sink = () => Promise.resolve()

    // Poll returns failed → re-initiate: back to init with attempts bumped.
    const pollCursor: SyncCursor = {
      kind: 'token',
      value: JSON.stringify({ stage: 'poll', handle: 'op1' }),
    }
    const out = await runAsyncExportSlice({ driver, sink, ctx: ctx(pollCursor) })
    expect(out.hasMore).toBe(true)
    expect(out.rateLimitWaitMs).toBe(0)
    expect(decodeAsyncCursor(out.nextCursor)).toMatchObject({ stage: 'init', attempts: 1 })
  })

  it('re-initiates an EXPIRED result url', async () => {
    const driver = fakeDriver({ statuses: [{ state: 'expired' }] })
    const sink = () => Promise.resolve()
    const pollCursor: SyncCursor = {
      kind: 'token',
      value: JSON.stringify({ stage: 'poll', handle: 'op1' }),
    }
    const out = await runAsyncExportSlice({ driver, sink, ctx: ctx(pollCursor) })
    expect(decodeAsyncCursor(out.nextCursor)).toMatchObject({ stage: 'init', attempts: 1 })
  })

  it('fails the run permanently after exhausting the re-initiate budget', async () => {
    const driver = fakeDriver({ statuses: [{ state: 'failed', reason: 'still broken' }] })
    const sink = () => Promise.resolve()
    // attempts already at the cap (3) → the next failure throws.
    const pollCursor: SyncCursor = {
      kind: 'token',
      value: JSON.stringify({ stage: 'poll', handle: 'op1', attempts: 3 }),
    }
    await expect(runAsyncExportSlice({ driver, sink, ctx: ctx(pollCursor) })).rejects.toThrow(
      /giving up after 3 re-initiates/
    )
  })

  it('re-enqueues the download on graceful abort (idempotent re-download)', async () => {
    const driver = fakeDriver({ records: [rec('a'), rec('b')] })
    const sink = vi.fn(() => Promise.resolve())
    const dlCursor: SyncCursor = {
      kind: 'token',
      value: JSON.stringify({ stage: 'download', url: 'https://x/file.jsonl' }),
    }
    // Signal pre-aborted → the loop yields before sinking, holding the download stage.
    const out = await runAsyncExportSlice({ driver, sink, ctx: ctx(dlCursor, true) })
    expect(sink).not.toHaveBeenCalled()
    expect(out.hasMore).toBe(true)
    expect(decodeAsyncCursor(out.nextCursor)).toMatchObject({ stage: 'download' })
  })
})
