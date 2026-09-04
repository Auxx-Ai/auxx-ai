// packages/lib/src/data-connectors/sweep-stranded-connectors.test.ts
// plans/money/tasks/43-connector-finalize-latch.md D-3: the backstop that releases a
// connector stuck `syncing` when its newest run has already ENDED — the shape
// `sweepStaleConnectorRuns` is structurally blind to, because that one keys on
// `status = 'running'` plus a cold heartbeat.
//
// The three things worth pinning, in order of how expensive getting them wrong is:
//   1. it must NOT touch a connector whose chain is genuinely still running;
//   2. it must NOT re-count `itemCount` as 0 or restamp `lastSyncedAt` (both would
//      corrupt what the detail view reports — see `releaseStrandedConnector`);
//   3. it must clear the leaked latch, and report the value BEFORE clearing it.

import { is, Param, SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeConnector {
  id: string
  organizationId: string
  status: string
  itemCount: number
  lastSyncedAt: Date | null
  error: string | null
  state: Record<string, unknown> | null
  updatedAt: Date
}

interface FakeRun {
  dataConnectorId: string
  status: 'running' | 'completed' | 'partial' | 'failed'
  startedAt: Date
  finishedAt: Date | null
}

const MINUTE = 60_000
const NOW = new Date('2026-09-03T22:30:00Z')
/** Older than STALE_RUN_MS (5 min), so the age gate passes. */
const LONG_AGO = new Date(NOW.getTime() - 30 * MINUTE)
/** Inside the threshold — must be left alone as possibly mid-finalize. */
const JUST_NOW = new Date(NOW.getTime() - 10_000)

const world = {
  connectors: [] as FakeConnector[],
  runs: [] as FakeRun[],
  published: [] as string[],
  itemCount: 4242,
}

function connector(over: Partial<FakeConnector> = {}): FakeConnector {
  return {
    id: 'dc1',
    organizationId: 'org1',
    status: 'syncing',
    itemCount: 4242,
    lastSyncedAt: new Date('2026-09-03T22:08:47Z'),
    error: null,
    state: { backfillStreamsRemaining: 1 },
    updatedAt: LONG_AGO,
    ...over,
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

/** Minimal drizzle stand-in: `select().from().where().orderBy().limit()` for runs. */
const db = {
  query: {
    DataConnector: {
      findMany: async ({ where }: { where: unknown }) => {
        const params = paramValues(where)
        return world.connectors
          .filter((c) => c.status === 'syncing')
          .filter((c) => (params.includes('dc2') ? c.id === 'dc2' : true))
      },
      findFirst: async ({ where }: { where: unknown }) => {
        const ids = paramValues(where)
        return world.connectors.find((c) => ids.includes(c.id)) ?? null
      },
    },
  },
  // Two different reads land here, told apart by their PROJECTION rather than by a
  // thenable object (which `lint/suspicious/noThenProperty` rightly refuses):
  //   - `countConnectorItems` selects `{ n: count() }`, awaited directly
  //   - the newest-run lookup selects run columns and chains `.orderBy().limit()`
  // 🛑 `countConnectorItems` cannot be stubbed with `vi.mock('./service')` here:
  // `releaseStrandedConnector` calls it from INSIDE the same module, and module mocking
  // does not intercept intra-module calls. The fake has to answer the real query.
  select: (projection: Record<string, unknown>) => ({
    from: () => ({
      where: (w: unknown) =>
        'n' in projection
          ? Promise.resolve([{ n: world.itemCount }])
          : {
              orderBy: () => ({
                limit: async () => {
                  const ids = paramValues(w)
                  const rows = world.runs
                    .filter((r) => ids.includes(r.dataConnectorId))
                    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
                  return rows.length > 0 ? [rows[0]] : []
                },
              }),
            },
    }),
  }),
  update: () => ({
    set: (patch: Record<string, unknown>) => ({
      where: (w: unknown) => ({
        returning: async () => {
          const ids = paramValues(w)
          // The release re-checks `status = 'syncing'` in its WHERE; honour that.
          const target = world.connectors.find((c) => ids.includes(c.id) && c.status === 'syncing')
          if (!target) return []
          if (typeof patch.status === 'string') target.status = patch.status
          if (typeof patch.itemCount === 'number') target.itemCount = patch.itemCount
          if ('error' in patch) target.error = patch.error as string | null
          // `state` arrives as a SQL expression that strips the latch key.
          if ('state' in patch) {
            const { backfillStreamsRemaining: _drop, ...rest } = target.state ?? {}
            target.state = rest
          }
          if (patch.lastSyncedAt instanceof Date) target.lastSyncedAt = patch.lastSyncedAt
          return [{ id: target.id }]
        },
      }),
    }),
  }),
}

// `./service` is deliberately NOT mocked — `releaseStrandedConnector` and
// `readConnectorBackfillLatch` are exactly what this file is testing, and they run
// against the fake db above.
vi.mock('./realtime', () => ({
  publishConnectorSync: async (_db: unknown, _org: string, id: string) => {
    world.published.push(id)
  },
}))

import { sweepStrandedConnectors } from './slice-orchestrator'

const DB = db as never

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  world.connectors = []
  world.runs = []
  world.published = []
  world.itemCount = 4242
})

describe('sweepStrandedConnectors (task 43 D-3)', () => {
  it('releases a connector whose newest run completed while leaking the latch', async () => {
    world.connectors = [connector()]
    world.runs = [
      { dataConnectorId: 'dc1', status: 'completed', startedAt: LONG_AGO, finishedAt: LONG_AGO },
    ]

    expect(await sweepStrandedConnectors(DB)).toBe(1)

    const c = world.connectors[0]!
    expect(c.status).toBe('live')
    // 🛑 The leaked latch is gone — otherwise the next run's finalize could inherit it.
    expect(c.state).toEqual({})
    expect(world.published).toEqual(['dc1'])
  })

  it('preserves lastSyncedAt and re-counts itemCount rather than zeroing it', async () => {
    // Both are corruptions `finalizeConnector({ ok: true })` would have caused: it writes
    // `itemCount ?? 0` and stamps `lastSyncedAt: now`.
    const before = new Date('2026-09-03T22:08:47Z')
    world.connectors = [connector({ lastSyncedAt: before, itemCount: 999 })]
    world.runs = [
      { dataConnectorId: 'dc1', status: 'completed', startedAt: LONG_AGO, finishedAt: LONG_AGO },
    ]

    await sweepStrandedConnectors(DB)

    const c = world.connectors[0]!
    expect(c.lastSyncedAt).toEqual(before)
    expect(c.itemCount).toBe(4242)
  })

  it('leaves a connector alone while its chain is still running', async () => {
    world.connectors = [connector()]
    world.runs = [
      { dataConnectorId: 'dc1', status: 'running', startedAt: LONG_AGO, finishedAt: null },
    ]

    expect(await sweepStrandedConnectors(DB)).toBe(0)
    expect(world.connectors[0]?.status).toBe('syncing')
    // The latch of a live multi-stream chain is nonzero BY DESIGN — never a trigger.
    expect(world.connectors[0]?.state).toEqual({ backfillStreamsRemaining: 1 })
  })

  it('leaves a just-finished run alone (it may still be mid-finalize)', async () => {
    world.connectors = [connector()]
    world.runs = [
      { dataConnectorId: 'dc1', status: 'completed', startedAt: JUST_NOW, finishedAt: JUST_NOW },
    ]

    expect(await sweepStrandedConnectors(DB)).toBe(0)
    expect(world.connectors[0]?.status).toBe('syncing')
  })

  it('releases a connector claimed with no run at all, keyed on its own updatedAt', async () => {
    // A crash between `claimForSync` and `openRun`.
    world.connectors = [connector({ state: null })]
    world.runs = []

    expect(await sweepStrandedConnectors(DB)).toBe(1)
    expect(world.connectors[0]?.status).toBe('live')
  })

  it('ignores connectors that are not syncing', async () => {
    world.connectors = [connector({ status: 'live' }), connector({ id: 'dc9', status: 'paused' })]
    world.runs = []

    expect(await sweepStrandedConnectors(DB)).toBe(0)
  })
})
