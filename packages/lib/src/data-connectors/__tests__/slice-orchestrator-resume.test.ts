// packages/lib/src/data-connectors/__tests__/slice-orchestrator-resume.test.ts
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
// NOT archived when the crawl completes. The re-import run, the history floor and the
// expired-delta restart (v14 §3) ride the same world.

import { is, Param, SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConditionGroup } from '../../conditions/types'
import type { SyncState, SyncStateStore } from '../../sync-core/contracts'
import type { ReimportRunOptions } from '../reimport-filter'
import type { RunStreamCursor } from '../sync-core-adapters'
import type {
  ConnectorQuery,
  ConnectorStreamQueryDecl,
  ConnectorStreamState,
  DataConnectorDefinition,
} from '../types'

// ── In-memory world ─────────────────────────────────────────────────────────────

interface FakeStream {
  id: string
  dataConnectorId: string
  organizationId: string
  streamKey: string
  syncMode: 'snapshot' | 'incremental'
  enabled: boolean
  requestConfig: null
  recordFilter: ConditionGroup[] | null
  state: ConnectorStreamState
}

interface FakeRun {
  id: string
  dataConnectorId: string
  status: 'running' | 'completed' | 'partial' | 'failed'
  phase: 'backfill' | 'steady' | null
  mode: string
  trigger: string
  chainSnapshot: Record<string, unknown> | null
  query: ConnectorQuery | null
  initiatedBy: string | null
  progress: { cursors?: Record<string, RunStreamCursor> } | null
  startedAt: Date
  sampleLimit: number | null
  fetched: number
}

const world = {
  streams: new Map<string, FakeStream>(),
  runs: [] as FakeRun[],
  runSeq: 0,
  connector: {} as Record<string, unknown>,
  claimable: true,
  latch: null as number | null,
  sliceQueue: [] as { streamId: string; runId: string }[],
  syncQueue: [] as SyncJob[],
  parkedAtCeiling: [] as string[],
  finalized: [] as { ok: boolean }[],
  resyncCleared: 0,
  fetchCalls: [] as {
    streamKey: string
    mode: string
    state: ConnectorStreamState
    query: ConnectorQuery
  }[],
  catalogStreams: [] as { key: string; query?: ConnectorStreamQueryDecl }[],
  /** `orders` answers a fetch with an expired delta: on a `since` query, or on every fetch. */
  expireOrders: null as null | 'since' | 'always',
  customerPages: 0,
  sinkFilters: [] as (ConditionGroup[] | undefined)[],
}

interface SyncJob {
  data: {
    trigger?: string
    reimport?: ReimportRunOptions
    continueRunId?: string
    retryClaim?: true
  }
  opts?: { delayMs?: number; jobKey?: string }
}

const PAGE_SIZE = 500
/** 25 pages × 500 = 12 500 customers: two slices (5 000 each) cross the 9 000 ceiling. */
const CUSTOMER_PAGES = 25

function resetWorld() {
  world.streams.clear()
  world.runs.length = 0
  world.runSeq = 0
  world.claimable = true
  world.latch = null
  world.sliceQueue.length = 0
  world.syncQueue.length = 0
  world.parkedAtCeiling.length = 0
  world.finalized.length = 0
  world.resyncCleared = 0
  world.fetchCalls.length = 0
  world.catalogStreams = []
  world.customerPages = CUSTOMER_PAGES
  world.expireOrders = null
  world.sinkFilters.length = 0
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
    recordFilter: null,
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
    recordFilter: null,
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

const spies = vi.hoisted(() => ({
  resolveRelationships: vi.fn(async () => {}),
  publishSyncRecordsChanged: vi.fn(async () => {}),
  reconcileOrphans: vi.fn(),
  reconcileManagedMarkers: vi.fn(async () => {}),
  streamStoreBuilt: vi.fn(),
}))

vi.mock('../service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service')>()
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
    claimForSync: async () => {
      if (!world.claimable) return false
      world.connector.status = 'syncing'
      return true
    },
    isNewestSyncRun: async (_db: unknown, _id: string, runId: string) =>
      world.runs.filter((r) => r.trigger !== 'webhook' && r.mode !== 'reimport').at(-1)?.id ===
      runId,
    initConnectorBackfillLatch: async (_db: unknown, _id: string, n: number) => {
      world.latch = n
    },
    decrementConnectorBackfillLatch: async () => {
      if (world.latch === null) return null
      world.latch = Math.max(world.latch - 1, 0)
      return world.latch
    },
    openRun: async (
      _db: unknown,
      input: {
        trigger: string
        mode: string
        phase?: 'backfill' | 'steady'
        chainSnapshot?: Record<string, unknown>
        query?: ConnectorQuery | null
        initiatedBy?: string | null
        progress?: FakeRun['progress']
      }
    ) => {
      const run: FakeRun = {
        id: `run${++world.runSeq}`,
        dataConnectorId: 'dc1',
        status: 'running',
        phase: input.phase ?? null,
        mode: input.mode,
        trigger: input.trigger,
        chainSnapshot: input.chainSnapshot ?? null,
        query: input.query ?? null,
        initiatedBy: input.initiatedBy ?? null,
        progress: input.progress ?? null,
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
      if (!run || run.status !== 'running') return false
      run.status = 'partial'
      world.connector.status = 'paused'
      world.parkedAtCeiling.push(input.runId)
      return true
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
    publishSyncRecordsChanged: spies.publishSyncRecordsChanged,
    setRunRateLimited: async () => {},
    parkConnectorSampleIfLastStream: async () => {},
  }
})

vi.mock('../sync-core-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync-core-adapters')>()
  return {
    ...actual,
    createStreamSyncStateStore: (_db: unknown, streamId: string): SyncStateStore => {
      spies.streamStoreBuilt(streamId)
      return {
        load: async () => actual.syncStateFromStream(world.streams.get(streamId)?.state ?? {}),
        save: async (sync: SyncState) => {
          const s = world.streams.get(streamId)
          if (s) s.state = actual.applySyncStateToStream(s.state, sync)
        },
      }
    },
    // In-memory mirror of `progress.cursors.<streamId>`; the SQL is covered in reimport.int.test.ts.
    createRunSyncStateStore: (_db: unknown, runId: string, streamId: string): SyncStateStore => ({
      load: async () => {
        const own = world.runs.find((r) => r.id === runId)?.progress?.cursors?.[streamId] ?? {}
        return { ...own, phase: own.phase ?? 'backfill' }
      },
      save: async (sync: SyncState) => {
        const run = world.runs.find((r) => r.id === runId)
        if (!run) return
        const { watermark: _held, ...own } = sync
        run.progress = { ...run.progress, cursors: { ...run.progress?.cursors, [streamId]: own } }
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

vi.mock('../data-connector-queue', () => ({
  enqueueBackfillSlice: async (data: { streamId: string; runId: string }) => {
    world.sliceQueue.push({ streamId: data.streamId, runId: data.runId })
  },
  enqueueConnectorSync: async (data: SyncJob['data'], opts?: SyncJob['opts']) => {
    world.syncQueue.push({ data, opts })
  },
}))

vi.mock('../realtime', () => ({ publishConnectorSync: async () => {} }))
// v12.1: the real `reconcileOrphans` reads the archive-cap keys and the minted set
// through these; the query double here has no `select`, and this test is about
// resume, not reconciliation.
vi.mock('../orphan-state', () => ({
  setArchiveCapTripped: async () => {},
  clearArchiveCapTripped: async () => {},
  takeArchiveCapOverride: async () => null,
  listMintedInstanceIds: async () => new Set(),
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishRecordsInvalidated: async () => {},
  publishRunCompleted: async () => {},
}))
vi.mock('../provisioning', () => ({ materializeConnectorTargets: async () => {} }))
vi.mock('../../apps/installations/app-field-provisioning', () => ({
  reconcileInstallationAppFields: async () => ({ errors: [] }),
}))
vi.mock('../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: async () => 'resolved',
}))
vi.mock('../../sync-core/throttle', () => ({
  createThrottleHandle: () => ({ run: (fn: () => unknown) => fn() }),
}))
vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async warmCache() {}
  },
}))
vi.mock('../../record-rules/sync-manifest-collector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../record-rules/sync-manifest-collector')>()
  return { ...actual, loadManifestCollector: async () => actual.createManifestCollector({}) }
})
vi.mock('../relationship-pass', () => ({ resolveRelationships: spies.resolveRelationships }))
vi.mock('../reconciliation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reconciliation')>()
  spies.reconcileOrphans.mockImplementation(actual.reconcileOrphans)
  return {
    ...actual,
    reconcileOrphans: spies.reconcileOrphans,
    reconcileManagedMarkers: spies.reconcileManagedMarkers,
  }
})
// The sink is the one seam that stays a spy: each fetched record counts as fetched
// (what the ceiling reads), and the orphan diff's inputs/outputs are what we assert.
vi.mock('../sink-source-record', () => ({
  sinkSourceRecord: async (
    ctx: { counters: { fetched: number } },
    _mappings: unknown,
    _record: unknown,
    _updatedAtPath: unknown,
    recordFilter: ConditionGroup[] | undefined
  ) => {
    ctx.counters.fetched += 1
    world.sinkFilters.push(recordFilter)
  },
}))
const listExistingItems = vi.fn()
const archiveRecord = vi.fn()
vi.mock('../sinks/entity-sink', () => ({
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
      world.fetchCalls.push({
        streamKey: args.streamKey,
        mode: args.mode,
        state: args.state,
        query: args.query,
      })
      if (
        args.streamKey === 'orders' &&
        (world.expireOrders === 'always' ||
          (world.expireOrders === 'since' && args.query.since !== undefined))
      ) {
        throw new ConnectorDeltaExpiredError('orders')
      }
      const from = args.state.backfillCursor ? Number(args.state.backfillCursor.value) : 1
      async function* customers() {
        for (let page = from; page <= world.customerPages; page++) {
          for (let i = 0; i < PAGE_SIZE; i++) {
            yield { streamKey: 'customers', fields: { id: `c-${page}-${i}` } }
          }
          yield {
            __checkpoint: true as const,
            cursor:
              page < world.customerPages
                ? { kind: 'pageNumber' as const, value: String(page + 1) }
                : undefined,
          }
        }
      }
      async function* orders() {
        yield { streamKey: 'orders', fields: { id: 'o-1' } }
        yield { __checkpoint: true as const, watermark: 'W2' }
      }
      return { records: args.streamKey === 'customers' ? customers() : orders() }
    },
  }
}
vi.mock('../connectors/app-connector-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../connectors/app-connector-adapter')>()),
  loadAppCatalogConnector: async () => ({ streams: world.catalogStreams }),
}))
vi.mock('../../accounting/ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => false,
}))
vi.mock('../connector-runtime', () => ({
  prepareConnectorFetch: async () => ({ definition: fixtureDefinition(), credential: null }),
}))

import { ConnectorDeltaExpiredError } from '../connectors/types'
import { periodFilterGroup } from '../reimport-filter'
import {
  BACKFILL_CONTINUE_DELAY_MS,
  backfillPendingChange,
  ConnectorClaimedError,
  runBackfillSlice,
  startConnectorSync,
} from '../slice-orchestrator'

const DB = db as never

async function runNextSlice(): Promise<void> {
  const job = world.sliceQueue.shift()!
  await runBackfillSlice(DB, {
    connectorId: 'dc1',
    organizationId: 'org1',
    streamId: job.streamId,
    runId: job.runId,
  })
}

/** Run every queued slice until the queue drains (the worker re-invoking the chain). */
async function drainSlices(): Promise<void> {
  while (world.sliceQueue.length > 0) await runNextSlice()
}

/** Run the next queued sync job the way the worker does. */
function runSyncJob(job: SyncJob) {
  const { trigger, ...rest } = job.data
  return startConnectorSync(DB, 'org1', 'dc1', { trigger: trigger as 'backfill', ...rest })
}

function state(id: string): ConnectorStreamState {
  return world.streams.get(id)!.state
}

function fetchesFor(streamKey: string, runIndexStart: number) {
  return world.fetchCalls.slice(runIndexStart).filter((c) => c.streamKey === streamKey)
}

beforeEach(() => {
  resetWorld()
  for (const spy of Object.values(spies)) spy.mockClear()
  listExistingItems.mockReset()
  archiveRecord.mockReset()
  listExistingItems.mockResolvedValue([])
})

describe('per-stream resume after the ingest ceiling (§6.3a step one)', () => {
  it('parks at the ceiling with the snapshot cursor checkpointed and the steady sibling untouched', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    expect(world.runs[0]?.phase).toBe('backfill')
    await drainSlices()

    // Run 1: two 5 000-record slices cross the 9 000 ceiling; the run parks and
    // enqueues one delayed continuation keyed on the parked run.
    expect(world.parkedAtCeiling).toEqual(['run1'])
    expect(world.runs[0]?.status).toBe('partial')
    expect(world.connector.status).toBe('paused')
    expect(world.syncQueue).toEqual([
      {
        data: {
          connectorId: 'dc1',
          organizationId: 'org1',
          trigger: 'backfill',
          continueRunId: 'run1',
          // A continuation that finds the connector claimed waits instead of being dropped.
          retryClaim: true,
        },
        opts: { delayMs: BACKFILL_CONTINUE_DELAY_MS, jobKey: 'continue-run1' },
      },
    ])

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

    // The continuation the park enqueued (the connector is paused; a `backfill`
    // trigger may claim a paused connector, so it flips back to syncing).
    await runSyncJob(world.syncQueue.shift()!)

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
    world.syncQueue.length = 0 // drop run1's continuation; this test drives the reset's sync
    await backfillPendingChange(DB, 'org1', 'dc1')
    expect(world.syncQueue).toEqual([
      {
        data: { connectorId: 'dc1', organizationId: 'org1', trigger: 'backfill' },
        opts: undefined,
      },
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
      mode: 'snapshot',
      trigger: 'manual',
      chainSnapshot: null,
      query: null,
      initiatedBy: null,
      progress: null,
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

describe('the history floor across a two-run backfill (v14 §3)', () => {
  const FLOOR = '2026-06-01T00:00:00.000Z'

  beforeEach(() => {
    world.connector.type = 'app:shop'
    world.connector.definitionKind = 'app'
    world.connector.config = { historyStartDate: '2026-06-01' }
    world.catalogStreams = [{ key: 'customers', query: { ids: true, period: 'createdAt' } }]
  })

  it('sends one floor on every slice of the run, and a floored crawl never reconciles', async () => {
    listExistingItems.mockResolvedValue([
      {
        id: 'i-gone',
        entityInstanceId: 'e0',
        entityDefinitionId: 'def-customers',
        lastSeenRunId: null,
      },
    ])

    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    const snapshot = world.runs[0]?.chainSnapshot as {
      floor?: string
      streams: Record<string, unknown>[]
    }
    expect(snapshot.floor).toBe(FLOOR)
    expect(snapshot.streams.find((s) => s.streamId === 's-customers')).toMatchObject({
      query: { ids: true, period: 'createdAt' },
    })
    await drainSlices()
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'backfill' })
    await drainSlices()

    const customerFetches = world.fetchCalls.filter((c) => c.streamKey === 'customers')
    expect(customerFetches.length).toBeGreaterThan(1)
    expect(customerFetches.every((c) => c.query.period?.from === FLOOR)).toBe(true)
    // The sibling declares no period, so the floor does not apply to it.
    expect(fetchesFor('orders', 0).every((c) => JSON.stringify(c.query) === '{}')).toBe(true)

    expect(state('s-customers').phase).toBe('steady')
    expect(listExistingItems).not.toHaveBeenCalled()
    expect(archiveRecord).not.toHaveBeenCalled()
  })

  it('sends no floor without a history date', async () => {
    world.connector.config = {}
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    expect(world.runs[0]?.chainSnapshot).not.toHaveProperty('floor')
    expect(world.fetchCalls.every((c) => JSON.stringify(c.query) === '{}')).toBe(true)
  })
})

describe('an expired delta restarts the stream backfill once per run (v14 §3)', () => {
  beforeEach(() => {
    world.connector.type = 'app:shop'
    world.connector.definitionKind = 'app'
    world.customerPages = 2
    world.catalogStreams = [{ key: 'orders', query: { ids: true, since: true } }]
    world.streams.get('s-orders')!.state = {
      phase: 'steady',
      watermark: JSON.stringify('2026-09-01'),
      recordsSeen: 42,
    }
  })

  it('clears the since, re-crawls the stream in the same run, and completes', async () => {
    world.expireOrders = 'since'
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()

    const orders = fetchesFor('orders', 0)
    expect(orders.map((c) => c.query)).toEqual([{ since: '2026-09-01' }, {}])
    expect(world.runs).toHaveLength(1)
    expect(world.runs[0]?.status).toBe('completed')
    expect(state('s-orders').phase).toBe('steady')
    expect(state('s-orders').watermark).toBe('W2')
  })

  it('a second expiry in the same run fails it', async () => {
    world.expireOrders = 'always'
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()

    expect(fetchesFor('orders', 0)).toHaveLength(2)
    expect(world.runs[0]?.status).toBe('failed')
    expect(world.finalized.at(-1)).toMatchObject({ ok: false })
  })
})

describe('the re-import run (v13 N5)', () => {
  const STORED_CUSTOMER_FILTER: ConditionGroup[] = [
    {
      id: 'g1',
      logicalOperator: 'AND',
      conditions: [{ id: 'c1', fieldId: 'orders_count', operator: '>', value: 0 }],
    },
  ]
  const STORED_ORDER_FILTER: ConditionGroup[] = [
    {
      id: 'g2',
      logicalOperator: 'AND',
      conditions: [{ id: 'c2', fieldId: 'financial_status', operator: 'is', value: 'paid' }],
    },
  ]
  const AUGUST = {
    period: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  }
  const reimportOf = (streamId: string): ReimportRunOptions => ({
    streamIds: [streamId],
    query: AUGUST,
    initiatedBy: 'u1',
  })
  const frozenState = (id: string) => JSON.stringify(state(id))

  beforeEach(() => {
    world.connector.type = 'app:shop'
    world.connector.definitionKind = 'app'
    world.connector.resyncPending = { streamIds: ['s-orders'] }
    world.customerPages = 2
    world.catalogStreams = [
      { key: 'orders', query: { ids: true, period: 'createdAt', since: true } },
      { key: 'customers', query: { ids: true, period: 'createdAt' } },
    ]
    Object.assign(world.streams.get('s-customers')!, {
      recordFilter: STORED_CUSTOMER_FILTER,
      state: { phase: 'steady', backfillStartedAt: '2026-01-01T00:00:00.000Z', recordsSeen: 7 },
    })
    Object.assign(world.streams.get('s-orders')!, {
      recordFilter: STORED_ORDER_FILTER,
      state: { phase: 'steady', watermark: JSON.stringify('W1'), recordsSeen: 42 },
    })
  })

  it('sends its own query and no since, and leaves stream state byte-identical', async () => {
    const before = frozenState('s-orders')
    const siblingBefore = frozenState('s-customers')

    await startConnectorSync(DB, 'org1', 'dc1', {
      trigger: 'manual',
      reimport: { ...reimportOf('s-orders'), requestId: 'req-1' },
    })
    expect(world.runs[0]).toMatchObject({
      mode: 'reimport',
      phase: 'backfill',
      query: AUGUST,
      initiatedBy: 'u1',
      progress: { requestId: 'req-1' },
    })
    expect(world.latch).toBe(1)
    expect(world.sliceQueue.map((j) => j.streamId)).toEqual(['s-orders'])

    await drainSlices()

    expect(frozenState('s-orders')).toBe(before)
    expect(frozenState('s-customers')).toBe(siblingBefore)
    expect(spies.streamStoreBuilt).not.toHaveBeenCalled()

    expect(world.fetchCalls).toHaveLength(1)
    const [fetch] = world.fetchCalls
    expect(fetch?.mode).toBe('snapshot')
    expect(fetch?.state.watermark).toBeUndefined()
    expect(fetch?.query).toEqual(AUGUST)
    // Post-fetch: the stream filter AND the period re-checked on the declared path.
    expect(world.sinkFilters[0]).toEqual([
      ...STORED_ORDER_FILTER,
      periodFilterGroup('createdAt', AUGUST.period),
    ])
  })

  it('finalizes with the relationship pass, ledger close, claim release and publish, but never reconciles', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', {
      trigger: 'manual',
      reimport: reimportOf('s-customers'),
    })
    await drainSlices()

    expect(spies.resolveRelationships).toHaveBeenCalledTimes(1)
    expect(spies.publishSyncRecordsChanged).toHaveBeenCalledTimes(1)
    expect(world.runs[0]?.status).toBe('completed')
    expect(world.finalized.map((f) => f.ok)).toEqual([true])
    expect(world.connector.status).toBe('live')
    expect(spies.reconcileOrphans).not.toHaveBeenCalled()
    expect(spies.reconcileManagedMarkers).not.toHaveBeenCalled()
    expect(world.resyncCleared).toBe(0)
    expect(world.fetchCalls.every((c) => JSON.stringify(c.query) === JSON.stringify(AUGUST))).toBe(
      true
    )
  })

  it('pages on the run row, resumes from its progress, and continues a parked run from its cursors', async () => {
    world.customerPages = 25
    const before = frozenState('s-customers')
    await startConnectorSync(DB, 'org1', 'dc1', {
      trigger: 'manual',
      reimport: reimportOf('s-customers'),
    })

    await runNextSlice()
    expect(world.runs[0]?.progress?.cursors?.['s-customers']?.cursor).toEqual({
      kind: 'pageNumber',
      value: '11',
    })
    expect(frozenState('s-customers')).toBe(before)

    // The next slice job (a crash replay reads the same place) starts from the run's cursor.
    await runNextSlice()
    expect(world.fetchCalls[1]?.state.backfillCursor).toEqual({ kind: 'pageNumber', value: '11' })

    // 10 000 fetched crosses the ceiling: the run parks and a re-import continuation is queued.
    expect(world.runs[0]?.status).toBe('partial')
    expect(world.syncQueue).toEqual([
      {
        data: {
          connectorId: 'dc1',
          organizationId: 'org1',
          trigger: 'backfill',
          reimport: reimportOf('s-customers'),
          continueRunId: 'run1',
          retryClaim: true,
        },
        opts: { delayMs: BACKFILL_CONTINUE_DELAY_MS, jobKey: 'continue-run1' },
      },
    ])

    await runSyncJob(world.syncQueue.shift()!)
    expect(world.runs[1]?.mode).toBe('reimport')
    expect(world.runs[1]?.progress?.cursors?.['s-customers']?.cursor).toEqual({
      kind: 'pageNumber',
      value: '21',
    })
    const fetchesBefore = world.fetchCalls.length
    await drainSlices()
    expect(world.fetchCalls[fetchesBefore]?.state.backfillCursor).toEqual({
      kind: 'pageNumber',
      value: '21',
    })
    expect(world.runs[1]?.status).toBe('completed')
    expect(frozenState('s-customers')).toBe(before)
  })
})

describe('waiting for the claim (v13 N5)', () => {
  it('throws for a claim-retrying job so BullMQ retries it, without erroring the connector', async () => {
    world.claimable = false
    const started = startConnectorSync(DB, 'org1', 'dc1', {
      trigger: 'manual',
      reimport: { streamIds: ['s-orders'], query: { ids: ['o-1'] } },
      retryClaim: true,
    })
    await expect(started).rejects.toBeInstanceOf(ConnectorClaimedError)
    expect(world.runs).toHaveLength(0)
    expect(world.finalized).toEqual([])
  })

  it('drops a plain sync that finds the connector claimed', async () => {
    world.claimable = false
    expect(await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })).toBe(false)
    expect(world.runs).toHaveLength(0)
  })

  it('drops a backfill continuation once a manual sync already resumed the parked run', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    const continuation = world.syncQueue.shift()!

    // Sync now resumes the parked crawl and completes it before the continuation fires.
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    expect(world.connector.status).toBe('live')
    const runs = world.runs.length

    expect(await runSyncJob(continuation)).toBe(false)
    expect(world.runs).toHaveLength(runs)
    expect(world.sliceQueue).toEqual([])
  })
})
