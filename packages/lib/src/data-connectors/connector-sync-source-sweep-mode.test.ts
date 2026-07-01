// packages/lib/src/data-connectors/connector-sync-source-sweep-mode.test.ts
// v9 §3 — during a sweep, `syncMode='incremental'` streams fetch a cheap watermark
// catch-up (mode:'incremental', persisted watermark passed through) instead of the
// full re-crawl a sweep forced before; `syncMode='snapshot'` streams keep re-crawling.
// Drives `fetchSlice` directly with empty mappings/no credential so no DB/crud/cache
// machinery is touched (mirrors the isolation style of app-connector-adapter.test.ts).

import { describe, expect, it, vi } from 'vitest'
import type { SyncSliceCtx } from '../sync-core/contracts'
import type { ConnectorSyncSourceDeps, SyncSourceStream } from './connector-sync-source'
import { createConnectorStreamSyncSource } from './connector-sync-source'
import type { DataConnectorDefinition, FetchResult } from './connectors/types'

const BUDGET = { maxPages: 10, maxRecords: 1_000, maxMs: 1_000_000 }

function sliceCtx(over: Partial<SyncSliceCtx> = {}): SyncSliceCtx {
  return {
    phase: 'backfill',
    budget: BUDGET,
    throttle: { run: (fn: () => unknown) => fn() },
    signal: new AbortController().signal,
    ...over,
  } as SyncSliceCtx
}

function stream(syncMode: 'snapshot' | 'incremental'): SyncSourceStream {
  return { streamId: 's1', streamKey: 'orders', syncMode, mappings: [] }
}

function deps(over: Partial<ConnectorSyncSourceDeps>, fetchMock: ReturnType<typeof vi.fn>) {
  const definition: DataConnectorDefinition = {
    type: 'fixture',
    schemaVersion: 1,
    requestModel: 'fixed',
    streams: [],
    fetch: fetchMock as unknown as DataConnectorDefinition['fetch'],
  }
  return {
    db: {} as never,
    organizationId: 'org1',
    connector: { id: 'dc1', credentialId: null } as never,
    definition,
    credential: null,
    config: {},
    run: { id: 'run1', startedAt: new Date() },
    stream: stream('incremental'),
    allStreams: [],
    now: () => 0,
    ...over,
  } as ConnectorSyncSourceDeps
}

/** An empty page — no records, no checkpoint (exhausted immediately). */
async function* emptyPage(): AsyncGenerator<never> {}
function emptyFetchResult(): FetchResult {
  return { records: emptyPage(), nextState: {} }
}

describe('sweep mode selection (v9 §3)', () => {
  it('fetches an incremental stream in mode:incremental during a sweep, with the persisted watermark', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyFetchResult())
    const source = createConnectorStreamSyncSource(
      deps({ stream: stream('incremental'), sweep: true }, fetchMock)
    )
    await source.fetchSlice(sliceCtx({ phase: 'backfill', watermark: '2024-01-01T00:00:00Z' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const args = fetchMock.mock.calls[0]?.[0]
    expect(args.mode).toBe('incremental')
    expect(args.state.watermark).toBe('2024-01-01T00:00:00Z')
  })

  it('still fetches a snapshot stream in mode:snapshot during a sweep', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyFetchResult())
    const source = createConnectorStreamSyncSource(
      deps({ stream: stream('snapshot'), sweep: true }, fetchMock)
    )
    await source.fetchSlice(sliceCtx({ phase: 'backfill', watermark: '2024-01-01T00:00:00Z' }))

    expect(fetchMock.mock.calls[0]?.[0].mode).toBe('snapshot')
  })

  it('fetches an incremental stream in mode:snapshot on a non-sweep backfill', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyFetchResult())
    const source = createConnectorStreamSyncSource(
      deps({ stream: stream('incremental'), sweep: false }, fetchMock)
    )
    await source.fetchSlice(sliceCtx({ phase: 'backfill' }))

    expect(fetchMock.mock.calls[0]?.[0].mode).toBe('snapshot')
  })

  it('fetches an incremental stream in mode:incremental on a normal steady run (unaffected by the sweep fix)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyFetchResult())
    const source = createConnectorStreamSyncSource(
      deps({ stream: stream('incremental'), sweep: false }, fetchMock)
    )
    await source.fetchSlice(sliceCtx({ phase: 'steady', watermark: '2024-02-02T00:00:00Z' }))

    expect(fetchMock.mock.calls[0]?.[0].mode).toBe('incremental')
    expect(fetchMock.mock.calls[0]?.[0].state.watermark).toBe('2024-02-02T00:00:00Z')
  })
})
