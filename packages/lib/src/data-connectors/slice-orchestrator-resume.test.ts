// packages/lib/src/data-connectors/slice-orchestrator-resume.test.ts
// plans/money/tasks/39 §3.4 / §6.3a step one: per-stream resume. Drives the REAL
// orchestrator (`startConnectorSync` + `runBackfillSlice`), the real sync-core runner,
// the real `ConnectorStreamSyncSource` and the real orphan diff over an in-memory
// world (stream state, run rows, latch, queue) with the DB-touching seams replaced
// by fakes. A fixture connector pages a snapshot `customers` stream large enough to
// trip the ingest ceiling, next to an incremental `orders` stream already in steady.
//
// Proves: a run parked by the ceiling resumes the snapshot stream from its cursor on
// the next trigger (page one is not re-read, `recordsSeen` continues); that trigger
// leaves the steady sibling's watermark alone and lets it run a delta inside the
// backfill run without closing the run under the crawl; the explicit reset still
// resets both; and a record seen only in the first run of the two-run backfill is
// NOT archived when the crawl completes.

import { is, Param, SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncState, SyncStateStore } from '../sync-core/contracts'
import type { ConnectorStreamState, DataConnectorDefinition } from './types'

// ── In-memory world ─────────────────────────────────────────────────────────────

interface FakeStream {
  id: string
  dataConnectorId: string
  organizationId: string
  streamKey: string
  syncMode: 'snapshot' | 'incremental'
  enabled: boolean
  requestConfig: null
  state: ConnectorStreamState
}

interface FakeRun {
  id: string
  dataConnectorId: string
  status: 'running' | 'completed' | 'partial' | 'failed'
  phase: 'backfill' | 'steady' | null
  trigger: string
  chainSnapshot: Record<string, unknown> | null
  startedAt: Date
  sampleLimit: number | null
  fetched: number
}

const world = {
  streams: new Map<string, FakeStream>(),
  runs: [] as FakeRun[],
  runSeq: 0,
  connector: {} as Record<string, unknown>,
  latch: null as number | null,
  sliceQueue: [] as { streamId: string; runId: string }[],
  syncQueue: [] as { trigger?: string }[],
  parkedAtCeiling: [] as string[],
  finalized: [] as { ok: boolean }[],
  resyncCleared: 0,
  fetchCalls: [] as { streamKey: string; mode: string; state: ConnectorStreamState }[],
}

const PAGE_SIZE = 500
/** 25 pages × 500 = 12 500 customers: two slices (5 000 each) cross the 9 000 ceiling. */
const CUSTOMER_PAGES = 25

function resetWorld() {
  world.streams.clear()
  world.runs.length = 0
  world.runSeq = 0
  world.latch = null
  world.sliceQueue.length = 0
  world.syncQueue.length = 0
  world.parkedAtCeiling.length = 0
  world.finalized.length = 0
  world.resyncCleared = 0
  world.fetchCalls.length = 0
  world.connector = {
    id: 'dc1',
    organizationId: 'org1',
    type: 'fixture',
    credentialId: null,
    appInstallationId: null,
    createdById: 'u1',
    config: {},
    state: null,
    status: 'live',
    resyncPending: null,
  }
  world.streams.set('s-customers', {
    id: 's-customers',
    dataConnectorId: 'dc1',
    organizationId: 'org1',
    streamKey: 'customers',
    syncMode: 'snapshot',
    enabled: true,
    requestConfig: null,
    state: {},
  })
  world.streams.set('s-orders', {
    id: 's-orders',
    dataConnectorId: 'dc1',
    organizationId: 'org1',
    streamKey: 'orders',
    syncMode: 'incremental',
    enabled: true,
    requestConfig: null,
    state: { phase: 'steady', watermark: 'W1', recordsSeen: 42 },
  })
}

/**
 * Collect every bound value out of a drizzle `where` tree. Under vitest the schema
 * columns resolve to `undefined`, so drizzle binds a raw value where it would bind a
 * `Param` against a real column; accept both shapes.
 */
function paramValues(where: unknown): unknown[] {
  const out: unknown[] = []
  const walk = (chunk: unknown) => {
    if (is(chunk, SQL)) for (const c of chunk.queryChunks) walk(c)
    else if (is(chunk, Param)) out.push(chunk.value)
    else if (Array.isArray(chunk)) for (const c of chunk) walk(c)
    else if (typeof chunk === 'string' || chunk instanceof Date) out.push(chunk)
  }
  walk(where)
  return out
}

const updateChain = {
  set: () => updateChain,
  where: () => updateChain,
  returning: async () => [],
}

const db = {
  query: {
    DataConnector: {
      findFirst: async () => world.connector,
      // `sweepStrandedConnectors` (task 43 D-3) runs at chain start. Faithful rather
      // than stubbed empty: it only ever sees a connector left `syncing` by this world.
      findMany: async () => (world.connector.status === 'syncing' ? [world.connector] : []),
    },
    DataConnectorRun: {
      findFirst: async ({ where }: { where: unknown }) => {
        const ids = paramValues(where)
        return world.runs.find((r) => ids.includes(r.id)) ?? null
      },
      findMany: async ({ where }: { where: unknown }) => {
        const params = paramValues(where)
        const since = params.find((p): p is Date => p instanceof Date)
        return world.runs
          .filter((r) => params.includes(r.dataConnectorId))
          .filter((r) => (since ? r.startedAt.getTime() >= since.getTime() : true))
          .map((r) => ({ id: r.id }))
      },
    },
    DataConnectorStream: {
      findFirst: async ({ where }: { where: unknown }) => {
        const ids = paramValues(where)
        return [...world.streams.values()].find((s) => ids.includes(s.id)) ?? null
      },
      findMany: async ({ where }: { where: unknown }) => {
        const ids = paramValues(where)
        return [...world.streams.values()].filter((s) => ids.includes(s.id))
      },
    },
  },
  update: () => updateChain,
}

/** A `DecodedMapping` that qualifies for orphan reconciliation (owned + upsert + archive). */
const customersMapping = {
  row: { id: 'm-customers' },
  rootPath: '$',
  linkMode: 'upsert',
  targetMode: 'owned',
  entityDefinitionId: 'def-customers',
  parentMappingId: null,
  relationshipFieldKey: null,
  orphanBehavior: 'archive',
  fieldMappings: [],
}

// ── Seams ───────────────────────────────────────────────────────────────────────

vi.mock('./service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service')>()
  return {
    ...actual,
    loadConnector: async () => ({
      connector: world.connector,
      streams: [...world.streams.values()].map((s) => ({
        stream: s,
        syncMode: s.syncMode,
        mappings: s.streamKey === 'customers' ? [customersMapping] : [],
      })),
    }),
    claimForSync: async () => true,
    initConnectorBackfillLatch: async (_db: unknown, _id: string, n: number) => {
      world.latch = n
    },
    decrementConnectorBackfillLatch: async () => {
      if (world.latch === null) return null
      world.latch = Math.max(world.latch - 1, 0)
      return world.latch
    },
    openRun: async (_db: unknown, input: { trigger: string; phase?: 'backfill' | 'steady' }) => {
      const run: FakeRun = {
        id: `run${++world.runSeq}`,
        dataConnectorId: 'dc1',
        status: 'running',
        phase: input.phase ?? null,
        trigger: input.trigger,
        chainSnapshot: (input as { chainSnapshot?: Record<string, unknown> }).chainSnapshot ?? null,
        startedAt: new Date(),
        sampleLimit: null,
        fetched: 0,
      }
      world.runs.push(run)
      return run
    },
    persistStreamState: async (_db: unknown, streamId: string, state: ConnectorStreamState) => {
      const s = world.streams.get(streamId)
      if (s) s.state = state
    },
    getRunFetched: async (_db: unknown, runId: string) =>
      world.runs.find((r) => r.id === runId)?.fetched ?? 0,
    parkBackfillAtCeiling: async (_db: unknown, input: { runId: string }) => {
      const run = world.runs.find((r) => r.id === input.runId)
      if (run) run.status = 'partial'
      world.connector.status = 'paused'
      world.parkedAtCeiling.push(input.runId)
    },
    finalizeConnector: async (_db: unknown, _id: string, input: { ok: boolean }) => {
      world.connector.status = input.ok ? 'live' : 'error'
      world.finalized.push(input)
    },
    countConnectorItems: async () => 0,
    clearResyncPending: async () => {
      world.resyncCleared += 1
      world.connector.resyncPending = null
    },
    foldRunManifest: async () => {},
    markRunManifestDegraded: async () => {},
    getRunManifest: async () => null,
    publishSyncRecordsChanged: async () => {},
    setRunRateLimited: async () => {},
    parkConnectorSampleIfLastStream: async () => {},
  }
})

vi.mock('./sync-core-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sync-core-adapters')>()
  return {
    ...actual,
    createStreamSyncStateStore: (_db: unknown, streamId: string): SyncStateStore => ({
      load: async () => actual.syncStateFromStream(world.streams.get(streamId)?.state ?? {}),
      save: async (sync: SyncState) => {
        const s = world.streams.get(streamId)
        if (s) s.state = actual.applySyncStateToStream(s.state, sync)
      },
    }),
    createConnectorRunLedger: (_db: unknown, run: { id: string }) => ({
      recordSlice: async (entry: { counters?: { fetched?: number } }) => {
        const r = world.runs.find((x) => x.id === run.id)
        if (r) r.fetched += entry.counters?.fetched ?? 0
      },
      finalize: async () => {
        const r = world.runs.find((x) => x.id === run.id)
        if (r) r.status = 'completed'
      },
      fail: async () => {
        const r = world.runs.find((x) => x.id === run.id)
        if (r) r.status = 'failed'
      },
    }),
  }
})

vi.mock('./data-connector-queue', () => ({
  enqueueBackfillSlice: async (data: { streamId: string; runId: string }) => {
    world.sliceQueue.push({ streamId: data.streamId, runId: data.runId })
  },
  enqueueConnectorSync: async (data: { trigger?: string }) => {
    world.syncQueue.push(data)
  },
}))

vi.mock('./realtime', () => ({ publishConnectorSync: async () => {} }))
vi.mock('../realtime', () => ({
  getRealtimeService: () => ({}),
  publishRecordsInvalidated: async () => {},
  publishRunCompleted: async () => {},
}))
vi.mock('./provisioning', () => ({ materializeConnectorTargets: async () => {} }))
vi.mock('../apps/installations/app-field-provisioning', () => ({
  reconcileInstallationAppFields: async () => ({ errors: [] }),
}))
vi.mock('../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: async () => 'resolved',
}))
vi.mock('../sync-core/throttle', () => ({
  createThrottleHandle: () => ({ run: (fn: () => unknown) => fn() }),
}))
vi.mock('../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async warmCache() {}
  },
}))
vi.mock('../record-rules/sync-manifest-collector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../record-rules/sync-manifest-collector')>()
  return { ...actual, loadManifestCollector: async () => actual.createManifestCollector({}) }
})
vi.mock('./relationship-pass', () => ({ resolveRelationships: async () => {} }))
vi.mock('./reconciliation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reconciliation')>()
  return { ...actual, reconcileManagedMarkers: async () => {} }
})
// The sink is the one seam that stays a spy: each fetched record counts as fetched
// (what the ceiling reads), and the orphan diff's inputs/outputs are what we assert.
vi.mock('./sink-source-record', () => ({
  sinkSourceRecord: async (ctx: { counters: { fetched: number } }) => {
    ctx.counters.fetched += 1
  },
}))
const listExistingItems = vi.fn()
const archiveRecord = vi.fn()
vi.mock('./sinks/entity-sink', () => ({
  entitySink: {
    listExistingItems: (...a: unknown[]) => listExistingItems(...a),
    archiveRecord: (...a: unknown[]) => archiveRecord(...a),
  },
}))

/**
 * The fixture connector. `customers` pages 1..CUSTOMER_PAGES from the cursor (a
 * `pageNumber` cursor names the NEXT page), terminal checkpoint after the last page.
 * `orders` yields one record and no cursor (a one-page delta). A function so the
 * hoisted mock factory below resolves it at call time, not module-evaluation time.
 */
function fixtureDefinition(): DataConnectorDefinition {
  return {
    type: 'fixture',
    schemaVersion: 1,
    requestModel: 'fixed',
    streams: [],
    fetch: async (args) => {
      world.fetchCalls.push({ streamKey: args.streamKey, mode: args.mode, state: args.state })
      const from = args.state.backfillCursor ? Number(args.state.backfillCursor.value) : 1
      async function* customers() {
        for (let page = from; page <= CUSTOMER_PAGES; page++) {
          for (let i = 0; i < PAGE_SIZE; i++) {
            yield { streamKey: 'customers', fields: { id: `c-${page}-${i}` } }
          }
          yield {
            __checkpoint: true as const,
            cursor:
              page < CUSTOMER_PAGES
                ? { kind: 'pageNumber' as const, value: String(page + 1) }
                : undefined,
          }
        }
      }
      async function* orders() {
        yield { streamKey: 'orders', fields: { id: 'o-1' } }
        yield { __checkpoint: true as const, watermark: 'W2' }
      }
      return { records: args.streamKey === 'customers' ? customers() : orders(), nextState: {} }
    },
  }
}
vi.mock('./connector-runtime', () => ({
  prepareConnectorFetch: async () => ({ definition: fixtureDefinition(), credential: null }),
}))

import { backfillPendingChange, runBackfillSlice, startConnectorSync } from './slice-orchestrator'

const DB = db as never

/** Run every queued slice until the queue drains (the worker re-invoking the chain). */
async function drainSlices(): Promise<void> {
  while (world.sliceQueue.length > 0) {
    const job = world.sliceQueue.shift()!
    await runBackfillSlice(DB, {
      connectorId: 'dc1',
      organizationId: 'org1',
      streamId: job.streamId,
      runId: job.runId,
    })
  }
}

function state(id: string): ConnectorStreamState {
  return world.streams.get(id)!.state
}

function fetchesFor(streamKey: string, runIndexStart: number) {
  return world.fetchCalls.slice(runIndexStart).filter((c) => c.streamKey === streamKey)
}

beforeEach(() => {
  resetWorld()
  listExistingItems.mockReset()
  archiveRecord.mockReset()
  listExistingItems.mockResolvedValue([])
})

describe('per-stream resume after the ingest ceiling (§6.3a step one)', () => {
  it('parks at the ceiling with the snapshot cursor checkpointed and the steady sibling untouched', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    expect(world.runs[0]?.phase).toBe('backfill')
    await drainSlices()

    // Run 1: two 5 000-record slices cross the 9 000 ceiling; the run parks.
    expect(world.parkedAtCeiling).toEqual(['run1'])
    expect(world.runs[0]?.status).toBe('partial')
    expect(world.connector.status).toBe('paused')

    const customers = state('s-customers')
    expect(customers.phase).toBe('backfill')
    expect(customers.backfillCursor).toEqual({ kind: 'pageNumber', value: '21' })
    expect(customers.recordsSeen).toBe(10_000)
    expect(customers.backfillStartedAt).toBe(world.runs[0]?.startedAt.toISOString())

    // The incremental sibling ran its delta inside the backfill run and kept steady.
    const orders = state('s-orders')
    expect(orders.phase).toBe('steady')
    expect(orders.watermark).toBe('W2')
    expect(fetchesFor('orders', 0)[0]?.mode).toBe('incremental')
    expect(fetchesFor('orders', 0)[0]?.state.watermark).toBe('W1')
  })

  it('resumes the snapshot stream from its checkpoint on the next trigger and does not reset the steady sibling', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    const parkedAt = { ...state('s-customers') }
    const ordersBefore = { ...state('s-orders') }
    const fetchesBefore = world.fetchCalls.length

    // Sync now again (the connector is paused; the claim flips it back to syncing).
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })

    // The trigger reset neither stream: the cursor, the progress and the backfill
    // marker survive on the snapshot stream; the sibling keeps its watermark.
    expect(state('s-customers').backfillCursor).toEqual(parkedAt.backfillCursor)
    expect(state('s-customers').recordsSeen).toBe(parkedAt.recordsSeen)
    expect(state('s-customers').backfillStartedAt).toBe(parkedAt.backfillStartedAt)
    expect(state('s-orders')).toEqual(ordersBefore)

    await drainSlices()

    // Page one was not re-read: every customers fetch of run 2 carried the cursor.
    const resumed = fetchesFor('customers', fetchesBefore)
    expect(resumed.length).toBeGreaterThan(0)
    expect(resumed[0]?.state.backfillCursor).toEqual({ kind: 'pageNumber', value: '21' })
    expect(resumed.every((c) => c.state.backfillCursor !== undefined)).toBe(true)

    // Progress continued to the end of the source and the crawl completed.
    expect(state('s-customers').recordsSeen).toBe(CUSTOMER_PAGES * PAGE_SIZE)
    expect(state('s-customers').phase).toBe('steady')
    expect(state('s-customers').backfillCursor).toBeUndefined()

    // The sibling ran a delta from its own watermark, not a fresh crawl.
    const sibling = fetchesFor('orders', fetchesBefore)
    expect(sibling).toHaveLength(1)
    expect(sibling[0]?.mode).toBe('incremental')
    expect(sibling[0]?.state.watermark).toBe('W2')

    // Run 2 closed exactly once, by the last stream, with the connector released
    // live; the sibling's steady completion did not close it under the crawl.
    expect(world.runs[1]?.status).toBe('completed')
    expect(world.parkedAtCeiling).toEqual(['run1'])
    expect(world.connector.status).toBe('live')
    expect(world.finalized.map((f) => f.ok)).toEqual([true])
  })

  it('the explicit reset (Backfill now on a pending structural change) still resets both streams', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    expect(state('s-customers').backfillCursor).toBeDefined()
    expect(state('s-orders').watermark).toBe('W2')

    world.connector.resyncPending = { streamIds: ['s-customers', 's-orders'] }
    await backfillPendingChange(DB, 'org1', 'dc1')
    expect(world.syncQueue).toEqual([
      { connectorId: 'dc1', organizationId: 'org1', trigger: 'backfill' },
    ])
    for (const id of ['s-customers', 's-orders']) {
      expect(state(id).phase).toBe('backfill')
      expect(state(id).backfillCursor).toBeUndefined()
      expect(state(id).watermark).toBeUndefined()
      expect(state(id).recordsSeen).toBe(0)
    }

    // The sync the reset enqueued: a pending stream never keeps its delta, so both
    // start a fresh crawl from page one (and the crawl parks at the ceiling again).
    const fetchesBefore = world.fetchCalls.length
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'backfill' })
    expect(state('s-customers').backfillStartedAt).toBe(world.runs[1]?.startedAt.toISOString())
    expect(state('s-orders').backfillStartedAt).toBe(world.runs[1]?.startedAt.toISOString())
    await drainSlices()
    expect(fetchesFor('customers', fetchesBefore)[0]?.state.backfillCursor).toBeUndefined()
    const orders = fetchesFor('orders', fetchesBefore)[0]
    expect(orders?.mode).toBe('snapshot')
    expect(orders?.state.watermark).toBeUndefined()
    expect(world.parkedAtCeiling).toEqual(['run1', 'run2'])
  })

  it('does not archive a record seen only in the first run of a two-run snapshot backfill', async () => {
    // A run from BEFORE this backfill began: items it last saw are genuine orphans.
    world.runs.push({
      id: 'run-old',
      dataConnectorId: 'dc1',
      status: 'completed',
      phase: 'backfill',
      trigger: 'manual',
      chainSnapshot: null,
      startedAt: new Date(Date.now() - 86_400_000),
      sampleLimit: null,
      fetched: 0,
    })
    listExistingItems.mockResolvedValue([
      {
        id: 'i-run-old',
        entityInstanceId: 'e0',
        entityDefinitionId: 'def-customers',
        lastSeenRunId: 'run-old',
      },
      {
        id: 'i-run1',
        entityInstanceId: 'e1',
        entityDefinitionId: 'def-customers',
        lastSeenRunId: 'run1',
      },
      {
        id: 'i-run2',
        entityInstanceId: 'e2',
        entityDefinitionId: 'def-customers',
        lastSeenRunId: 'run2',
      },
    ])

    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    // Nothing reconciles on a parked run.
    expect(archiveRecord).not.toHaveBeenCalled()

    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    expect(world.runs.map((r) => r.id)).toEqual(['run-old', 'run1', 'run2'])

    // Only the item last seen before the backfill began is archived.
    expect(archiveRecord).toHaveBeenCalledTimes(1)
    expect(archiveRecord.mock.calls[0]?.[1]).toMatchObject({ id: 'i-run-old' })
  })
})
