// packages/lib/src/data-connectors/connector-sync-source-record-filter.test.ts
// v11 — the MAIN sync door honours the stream's record filter. Drives `fetchSlice`
// directly with empty mappings/no credential so no DB/crud/cache machinery is touched
// (same isolation style as connector-sync-source-sweep-mode.test.ts): with nothing to
// map, a record's only observable effect is which counter it lands in, which is
// exactly what this pins.

import { describe, expect, it, vi } from 'vitest'

// buildCtx builds a B2 manifest collector (loadManifestCollector → cache/db). Override
// ONLY the loader to a zero-subscription real collector (pure, DB-free).
vi.mock('../record-rules/sync-manifest-collector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../record-rules/sync-manifest-collector')>()
  return {
    ...actual,
    loadManifestCollector: async () => actual.createManifestCollector({}),
  }
})

import type { ConditionGroup } from '../conditions/types'
import type { SyncSliceCtx } from '../sync-core/contracts'
import type { ConnectorSyncSourceDeps, SyncSourceStream } from './connector-sync-source'
import { createConnectorStreamSyncSource } from './connector-sync-source'
import type { ConnectorRecord, DataConnectorDefinition, FetchResult } from './connectors/types'

const BUDGET = { maxPages: 10, maxRecords: 1_000, maxMs: 1_000_000 }

function sliceCtx(): SyncSliceCtx {
  return {
    phase: 'backfill',
    budget: BUDGET,
    throttle: { run: (fn: () => unknown) => fn() },
    signal: new AbortController().signal,
  } as SyncSliceCtx
}

/** `orders_count > 0` — the merchant case that motivated the feature. */
const HAS_ORDERS: ConditionGroup[] = [
  {
    id: 'g1',
    logicalOperator: 'AND',
    conditions: [{ id: 'c0', fieldId: 'orders_count', operator: '>', value: 0 }],
  } as ConditionGroup,
]

function stream(recordFilter?: ConditionGroup[]): SyncSourceStream {
  return { streamId: 's1', streamKey: 'customer', syncMode: 'snapshot', mappings: [], recordFilter }
}

function customer(id: string, ordersCount: number): ConnectorRecord {
  return {
    streamKey: 'customer',
    externalId: id,
    displayName: id,
    fields: { id, orders_count: ordersCount },
  }
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
    stream: stream(),
    allStreams: [],
    now: () => 0,
    ...over,
  } as ConnectorSyncSourceDeps
}

/** One page of three customers: two have ordered, one never has. */
function threeCustomers(): FetchResult {
  async function* page(): AsyncGenerator<ConnectorRecord> {
    yield customer('c1', 3)
    yield customer('c2', 0)
    yield customer('c3', 1)
  }
  return { records: page(), nextState: {} }
}

describe('sliced fetch — per-stream record filter (v11)', () => {
  it('skips the non-matching records while still paging the whole slice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(threeCustomers())
    const source = createConnectorStreamSyncSource(deps({ stream: stream(HAS_ORDERS) }, fetchMock))

    const result = await source.fetchSlice(sliceCtx())

    // One of the three never ordered.
    expect(result.counters?.skipped).toBe(1)
    // The slice still PAGED all three — the filter is a sink-side drop, not a fetch
    // that stopped short, which is what keeps pagination and the watermark honest.
    expect(result.recordsProcessed).toBe(3)
    // A filtered record is not a failure and never enters the error sample — which is
    // what keeps a heavily-filtering run `completed` rather than `partial`.
    expect(result.counters?.failed).toBe(0)
    expect(result.errorSample ?? []).toEqual([])
  })

  it('a filter that excludes EVERY record produces a clean, all-skipped slice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(threeCustomers())
    const impossible: ConditionGroup[] = [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [{ id: 'c0', fieldId: 'orders_count', operator: '>', value: 99 }],
      } as ConditionGroup,
    ]
    const source = createConnectorStreamSyncSource(deps({ stream: stream(impossible) }, fetchMock))

    const result = await source.fetchSlice(sliceCtx())

    expect(result.counters?.skipped).toBe(3)
    expect(result.counters?.failed).toBe(0)
    expect(result.errorSample ?? []).toEqual([])
  })

  it('no filter on the stream ⇒ nothing is skipped (no behavior change)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(threeCustomers())
    const source = createConnectorStreamSyncSource(deps({ stream: stream() }, fetchMock))

    const result = await source.fetchSlice(sliceCtx())

    expect(result.recordsProcessed).toBe(3)
    expect(result.counters?.skipped).toBe(0)
  })

  // The filter runs strictly DOWNSTREAM of `fetch`, which is what keeps it out of the
  // watermark's way: the connector computes its next watermark over every row on the
  // page before the platform sees a record. If it ever moved upstream, a page whose
  // records all fail the filter would never advance the delta floor and every
  // incremental run would re-crawl from the same point forever.
  it('does not touch the watermark the connector reported', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      // The connector computes its watermark over every row on the page, inside
      // `fetch`, and reports it on the terminal checkpoint.
      records: (async function* () {
        yield customer('c2', 0)
        yield { __checkpoint: true, watermark: '2026-09-03T00:00:00Z' }
      })(),
      nextState: {},
    } as FetchResult)
    const source = createConnectorStreamSyncSource(deps({ stream: stream(HAS_ORDERS) }, fetchMock))

    const result = await source.fetchSlice(sliceCtx())

    expect(result.counters?.skipped).toBe(1)
    expect(result.watermark).toBe('2026-09-03T00:00:00Z')
  })
})
