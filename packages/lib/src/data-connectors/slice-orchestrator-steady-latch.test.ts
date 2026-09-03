// packages/lib/src/data-connectors/slice-orchestrator-steady-latch.test.ts
// plans/money/tasks/43-connector-finalize-latch.md: the B1 latch must reach zero in a
// MULTI-STREAM STEADY run, so the last stream runs the connector-level finalize and
// releases the claim. Drives the REAL orchestrator (`startConnectorSync` +
// `runBackfillSlice`), the real sync-core runner and the real
// `ConnectorStreamSyncSource` over an in-memory world.
//
// The defect this pins: the runner used to close a steady run itself on the FIRST
// stream to finish. Every sibling's next slice then read `status !== 'running'` and
// returned WITHOUT decrementing the latch, so the latch never hit zero, the
// connector-level finalize never fired, and the connector was stranded `syncing` with a
// `completed` run — a state `sweepStaleConnectorRuns` (which only sees `running` runs)
// can never rescue. Observed live on a 3-stream Shopify connector, latch stuck at 1.
//
// ⚠️ `drainSlices` runs slices SEQUENTIALLY, which makes the bug deterministic rather
// than racy here: pre-fix, stream 1 closes the run and streams 2 and 3 both bail, so the
// latch lands on 2. In production the streams run concurrently and the landing value
// depends on how many got past the guard before the close committed (it was 1 there).
// Either way the invariant under test is the same: the latch must reach 0.

import { is, Param, SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncState, SyncStateStore } from '../sync-core/contracts'
import type { ConnectorStreamState, DataConnectorDefinition } from './types'

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

/** Three streams, all already in steady — this is what makes the RUN phase steady. */
const STREAM_KEYS = ['customers', 'orders', 'products'] as const

const world = {
  streams: new Map<string, FakeStream>(),
  runs: [] as FakeRun[],
  runSeq: 0,
  connector: {} as Record<string, unknown>,
  latch: null as number | null,
  sliceQueue: [] as { streamId: string; runId: string }[],
  finalized: [] as { ok: boolean }[],
  resyncCleared: 0,
  fetchCalls: [] as { streamKey: string }[],
}

function resetWorld() {
  world.streams.clear()
  world.runs.length = 0
  world.runSeq = 0
  world.latch = null
  world.sliceQueue.length = 0
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
    // A pending mapping-edit marker, so the test can prove a STEADY run does not
    // clear it even though its last stream now closes the run.
    resyncPending: { level: 'rebackfill', reasons: ['record-filter'] },
  }
  for (const key of STREAM_KEYS) {
    world.streams.set(`s-${key}`, {
      id: `s-${key}`,
      dataConnectorId: 'dc1',
      organizationId: 'org1',
      streamKey: key,
      syncMode: 'incremental',
      enabled: true,
      requestConfig: null,
      state: { phase: 'steady', watermark: 'W1', recordsSeen: 10 },
    })
  }
}

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

const updateChain = { set: () => updateChain, where: () => updateChain, returning: async () => [] }

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
        return world.runs
          .filter((r) => params.includes(r.dataConnectorId))
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

vi.mock('./service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service')>()
  return {
    ...actual,
    loadConnector: async () => ({
      connector: world.connector,
      streams: [...world.streams.values()].map((s) => ({
        stream: s,
        syncMode: s.syncMode,
        mappings: [],
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
    parkBackfillAtCeiling: async () => {},
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
  enqueueConnectorSync: async () => {},
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
vi.mock('../agents/bindings/resolve', () => ({ resolveConnectorFieldRef: async () => 'resolved' }))
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
vi.mock('./sink-source-record', () => ({
  sinkSourceRecord: async (ctx: { counters: { fetched: number } }) => {
    ctx.counters.fetched += 1
  },
}))
vi.mock('./sinks/entity-sink', () => ({
  entitySink: { listExistingItems: async () => [], archiveRecord: async () => {} },
}))

/** Every stream yields a one-page delta and a terminal watermark checkpoint. */
function fixtureDefinition(): DataConnectorDefinition {
  return {
    type: 'fixture',
    schemaVersion: 1,
    requestModel: 'fixed',
    streams: [],
    fetch: async (args) => {
      world.fetchCalls.push({ streamKey: args.streamKey })
      async function* one() {
        yield { streamKey: args.streamKey, fields: { id: `${args.streamKey}-1` } }
        yield { __checkpoint: true as const, watermark: 'W2' }
      }
      return { records: one(), nextState: {} }
    },
  }
}
vi.mock('./connector-runtime', () => ({
  prepareConnectorFetch: async () => ({ definition: fixtureDefinition(), credential: null }),
}))

import { runBackfillSlice, startConnectorSync } from './slice-orchestrator'

const DB = db as never

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

beforeEach(resetWorld)

describe('B1 latch in a multi-stream STEADY run (task 43)', () => {
  it('drives the latch to zero so the last stream finalizes and releases the connector', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })

    // Guard the premise: every stream was already steady, so this is a STEADY run.
    // If this ever flips to `backfill` the test stops covering the defect.
    expect(world.runs[0]?.phase).toBe('steady')
    expect(world.latch).toBe(STREAM_KEYS.length)

    await drainSlices()

    // Every stream ran its delta — none bailed early on a prematurely closed run.
    expect(world.fetchCalls.map((c) => c.streamKey).sort()).toEqual([...STREAM_KEYS].sort())

    // 🛑 The regression. Pre-fix the runner closed the run on the first stream, the
    // other two bailed without decrementing, and this landed on 2.
    expect(world.latch).toBe(0)

    // The last stream owns the run close AND the connector release.
    expect(world.runs[0]?.status).toBe('completed')
    expect(world.connector.status).toBe('live')
    // Exactly once — the latch is what stops the other two streams finalizing too.
    expect(world.finalized).toHaveLength(1)
    expect(world.finalized[0]?.ok).toBe(true)
  })

  it('does not clear a pending re-sync marker, even though its last stream closes the run', async () => {
    // The D-1 split: `closeRun` is unconditional but `clearResync` stays backfill-only.
    // Collapsing them back into one flag would silently clear this marker.
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()

    expect(world.runs[0]?.status).toBe('completed')
    expect(world.resyncCleared).toBe(0)
    expect(world.connector.resyncPending).not.toBeNull()
  })
})
