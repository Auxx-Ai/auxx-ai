// packages/lib/src/data-connectors/connectors/__tests__/app-connector-adapter.test.ts
// Coverage for the app-connector adapter's pagination loop (Step 11): each
// `execute` is one page of `args.query`, the adapter loops it and emits a checkpoint
// after each, translating the engine's structured `SyncCursor` ↔ the app's flat cursor.
// Also proves the chain RESUMES across slices via `runConnectorSlice`, that `since`
// rides the terminal checkpoint only, and that an expired delta crosses as an error.
// The lambda cluster + org cache + connection resolver are mocked (lazy-imported).

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RunLedger,
  SliceBudget,
  SyncCursor,
  SyncSliceCtx,
  SyncSource,
  SyncState,
} from '../../../sync-core/contracts'
import { runSyncSlice } from '../../../sync-core/slice-runner'
import { runConnectorSlice } from '../../connector-slice-loop'
import { type AppConnectorContext, appConnectorAdapter } from '../app-connector-adapter'
import { decodeCursor, decodeSince, encodeCursor } from '../app-connector-state'
import {
  ConnectorDeltaExpiredError,
  type ConnectorQuery,
  type ConnectorRecord,
  type ConnectorYield,
  isConnectorCheckpoint,
} from '../types'

const invokeLambdaExecutor = vi.fn()
const prepareLambdaContext = vi.fn((...args: unknown[]) => args[0])
const resolveAppConnectionForRuntime = vi.fn()

const RESOLVED_METADATA = { shopDomain: 'acme.myshopify.com' }

const INSTALLED_APP = {
  installationId: 'inst1',
  app: { id: 'app1', slug: 'test' },
  currentDeployment: { serverBundleSha: 'sha1' },
  dataConnectors: [
    {
      id: 'test.things',
      requiresConnection: true,
      streams: [
        {
          key: 'thing',
          query: { ids: true, since: true },
          mappings: [
            {
              rootPath: '',
              target: { entityKey: 'thing' },
              fields: [{ key: 'name', sourcePath: 'name' }],
            },
          ],
          exampleRecord: {},
        },
      ],
    },
  ],
}

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    get: async (_org: string, key: string) => {
      if (key === 'installedApps') return [INSTALLED_APP]
      if (key === 'orgProfile') return { handle: 'acme', name: 'Acme' }
      return undefined
    },
  }),
}))

vi.mock('../../../apps/lambda', () => ({
  invokeLambdaExecutor: (...args: unknown[]) => invokeLambdaExecutor(...args),
  prepareLambdaContext: (...args: unknown[]) => prepareLambdaContext(...args),
}))

vi.mock('../../../apps/connections/resolve-app-connection-for-runtime', () => ({
  resolveAppConnectionForRuntime: (...args: unknown[]) => resolveAppConnectionForRuntime(...args),
}))

const ctx = (): AppConnectorContext => ({
  db: {} as never,
  organizationId: 'org1',
  connector: {
    id: 'c1',
    type: 'app:test',
    credentialId: 'cred1',
    appInstallationId: 'inst1',
  },
})

const rec = (id: string): ConnectorRecord => ({
  streamKey: 'thing',
  externalId: id,
  displayName: id,
  fields: { id },
})

/** Queue one page response (`ok` Result wrapping the sandbox execution_result). */
function page(records: ConnectorRecord[], rest: Record<string, unknown> = {}) {
  return ok({ execution_result: { records, ...rest } })
}

/** The lambda payload of the nth invoke. */
function payload(n = 0): Record<string, unknown> {
  return invokeLambdaExecutor.mock.calls[n]![0].payload
}

/** Drive the adapter's fetch and collect everything the generator yields. */
async function drain(
  opts: {
    state?: Record<string, unknown>
    query?: ConnectorQuery
    config?: Record<string, unknown>
    triggerContext?: Record<string, string>
  } = {}
): Promise<ConnectorYield[]> {
  const { records } = await appConnectorAdapter('app:test', ctx()).fetch({
    streamKey: 'thing',
    query: opts.query ?? {},
    mode: 'snapshot',
    state: (opts.state ?? {}) as never,
    credential: null,
    config: (opts.config ?? {}) as never,
    triggerContext: opts.triggerContext,
  })
  const out: ConnectorYield[] = []
  for await (const y of records) out.push(y)
  return out
}

beforeEach(() => {
  invokeLambdaExecutor.mockReset()
  prepareLambdaContext.mockClear()
  resolveAppConnectionForRuntime.mockReset()
  resolveAppConnectionForRuntime.mockResolvedValue(
    ok({
      userConnection: { value: 'tok', metadata: RESOLVED_METADATA },
      organizationConnection: { value: 'tok', metadata: RESOLVED_METADATA },
    })
  )
})

describe('appConnectorAdapter pagination', () => {
  it('loops execute over multiple pages, emitting non-terminal then terminal checkpoints', async () => {
    invokeLambdaExecutor
      .mockResolvedValueOnce(page([rec('a')], { cursor: 'c1' }))
      .mockResolvedValueOnce(page([rec('b')], { cursor: 'c2' }))
      .mockResolvedValueOnce(page([rec('c')], { since: '2024-01-01' }))

    const yields = await drain()

    const records = yields.filter((y) => !isConnectorCheckpoint(y)) as ConnectorRecord[]
    expect(records.map((r) => r.externalId)).toEqual(['a', 'b', 'c'])

    const checkpoints = yields.filter(isConnectorCheckpoint)
    expect(checkpoints).toHaveLength(3)
    expect(checkpoints[0]!.cursor?.kind).toBe('token')
    expect(decodeCursor(checkpoints[0]!.cursor)).toBe('c1')
    expect(decodeCursor(checkpoints[1]!.cursor)).toBe('c2')
    expect(checkpoints[2]!.cursor).toBeUndefined()
    expect(invokeLambdaExecutor).toHaveBeenCalledTimes(3)
  })

  it('carries since on the terminal checkpoint only, JSON-encoded', async () => {
    const since = { historyId: '84422' }
    invokeLambdaExecutor
      .mockResolvedValueOnce(page([rec('a')], { cursor: 'c1', since: 'ignored-mid-chain' }))
      .mockResolvedValueOnce(page([rec('b')], { since }))
    const checkpoints = (await drain()).filter(isConnectorCheckpoint)
    expect(checkpoints[0]!.since).toBeUndefined()
    expect(decodeSince(checkpoints[1]!.since)).toEqual(since)
    expect(checkpoints.every((c) => c.watermark === undefined)).toBe(true)
  })

  it('a terminal page with no since leaves the checkpoint without one', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a'), rec('b')]))
    const checkpoints = (await drain()).filter(isConnectorCheckpoint)
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]!.cursor).toBeUndefined()
    expect(checkpoints[0]!.since).toBeUndefined()
  })

  it('sends args.query verbatim and the decoded page cursor', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([]))
    const backfillCursor: SyncCursor = { kind: 'token', value: JSON.stringify({ after: 'c2' }) }
    const query = { period: { from: '2026-01-01T00:00:00.000Z' }, since: '2026-09-01' }
    await drain({ state: { backfillCursor, watermark: 'never-sent' }, query })

    expect(payload()).toMatchObject({ streamKey: 'thing', query, cursor: { after: 'c2' } })
    expect(payload()).not.toHaveProperty('state')
    expect(payload()).not.toHaveProperty('mode')
  })

  it('omits cursor on the first page of a query', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([]))
    await drain()
    expect(payload()).not.toHaveProperty('cursor')
  })

  it('never forwards triggerContext, which is generic REST steering', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([]))
    await drain({ query: { ids: ['1'] }, triggerContext: { resourceId: '123' } })
    expect(payload()).not.toHaveProperty('triggerContext')
    expect(payload().query).toEqual({ ids: ['1'] })
  })

  it('forwards the resolved connection (incl. metadata) into the lambda context', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([]))
    await drain()
    const lambdaArgs = prepareLambdaContext.mock.calls[0]![0] as {
      organizationConnection: { metadata: unknown }
    }
    expect(lambdaArgs.organizationConnection.metadata).toEqual(RESOLVED_METADATA)
  })

  it('throws ConnectorDeltaExpiredError before yielding a record of an expired page', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')], { deltaExpired: true }))
    const seen: ConnectorYield[] = []
    const run = async () => {
      for (const y of await drain({ query: { since: 'stale' } })) seen.push(y)
    }
    await expect(run()).rejects.toBeInstanceOf(ConnectorDeltaExpiredError)
    expect(seen).toEqual([])
  })
})

describe('appConnectorAdapter resumes across slices', () => {
  const BUDGET: SliceBudget = { maxPages: 1, maxRecords: 1_000, maxMs: 1_000_000 }
  const sliceCtx = (over: Partial<SyncSliceCtx> = {}): SyncSliceCtx =>
    ({
      phase: 'backfill',
      budget: BUDGET,
      throttle: { run: (fn: () => unknown) => fn() },
      signal: new AbortController().signal,
      ...over,
    }) as SyncSliceCtx

  const sliceFetch = () => (resume: { backfillCursor?: SyncCursor; watermark?: string }) =>
    appConnectorAdapter('app:test', ctx()).fetch({
      streamKey: 'thing',
      query: {},
      mode: 'snapshot',
      state: resume as never,
      credential: null,
      config: {} as never,
    })

  it('slice 1 yields hasMore + page-1 cursor; slice 2 seeded with it advances', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')], { cursor: 'c1' }))
    const slice1 = await runConnectorSlice({
      fetch: sliceFetch(),
      sink: async () => {},
      ctx: sliceCtx(),
      now: () => 0,
    })
    expect(slice1.hasMore).toBe(true)
    expect(decodeCursor(slice1.nextCursor)).toBe('c1')

    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('b')], { since: 's2' }))
    const slice2 = await runConnectorSlice({
      fetch: sliceFetch(),
      sink: async () => {},
      ctx: sliceCtx({ cursor: slice1.nextCursor }),
      now: () => 0,
    })
    expect(slice2.hasMore).toBe(false)
    expect(payload(1).cursor).toBe('c1')
  })

  it('replaces the inbound watermark with the app since — never a max', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')], { since: 'aaa' }))
    const slice = await runConnectorSlice({
      fetch: sliceFetch(),
      sink: async () => {},
      ctx: sliceCtx({ phase: 'steady', watermark: JSON.stringify('zzz') }),
      now: () => 0,
    })
    expect(decodeSince(slice.watermark)).toBe('aaa')
  })

  it('keeps the inbound watermark when the last page returns no since', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')]))
    const inbound = JSON.stringify('zzz')
    const slice = await runConnectorSlice({
      fetch: sliceFetch(),
      sink: async () => {},
      ctx: sliceCtx({ phase: 'steady', watermark: inbound }),
      now: () => 0,
    })
    expect(slice.watermark).toBe(inbound)
  })
})

// ── The app's declared config actually reaches `execute` ─────────────────────────
// Regression for v11 §7: the setup stepper writes each declared key at the TOP LEVEL of
// `connector.config`, so that is where the adapter must read the app's config from.

describe('appConnectorAdapter config passthrough', () => {
  /** The `config` the sandbox was handed on the first (only) page. */
  function sentConfig(): unknown {
    return payload().config
  }

  it('delivers the app’s top-level declared config keys to execute', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')]))
    await drain({ config: { locationId: 'gid://shopify/Location/1', includeArchived: false } })
    expect(sentConfig()).toEqual({
      locationId: 'gid://shopify/Location/1',
      includeArchived: false,
    })
  })

  it('strips the four PLATFORM-reserved keys — an app never sees the engine’s own config', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')]))
    await drain({
      config: {
        endpoint: { baseUrl: 'https://example.test' },
        // `filters` stays reserved: the fixture connector reads `config.filters.fixtures`.
        filters: { fixtures: [] },
        historyStartDate: '2026-01-01',
        webhookTrigger: { triggerId: 't1' },
        locationId: 'loc1',
      },
    })
    expect(sentConfig()).toEqual({ locationId: 'loc1' })
  })

  it('an app that declares no config still gets `{}`, never undefined', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')]))
    await drain()
    expect(sentConfig()).toEqual({})
  })
})

// see plans/apps/shopify/shopify-v3-graphql-plan.md §12.1
describe('appConnectorAdapter rateLimited', () => {
  const BUDGET: SliceBudget = { maxPages: 5, maxRecords: 1_000, maxMs: 1_000_000 }

  /** A connector SyncSource over the adapter, driven by the real core slice runner. */
  function harness(initial: SyncState) {
    let state = initial
    const calls: string[] = []
    const ledger: RunLedger = {
      recordSlice: async () => {},
      finalize: async () => {},
      fail: async () => {
        calls.push('fail')
      },
    }
    const source: SyncSource = {
      id: 'app:test',
      throttleKey: 'app:test',
      fetchSlice: (sliceCtx) =>
        runConnectorSlice({
          fetch: (resume) =>
            appConnectorAdapter('app:test', ctx()).fetch({
              streamKey: 'thing',
              query: {},
              mode: 'snapshot',
              state: resume as never,
              credential: null,
              config: {} as never,
            }),
          sink: async () => {},
          ctx: sliceCtx,
          now: () => 0,
        }),
    }
    const run = () =>
      runSyncSlice({
        source,
        stateStore: {
          load: async () => state,
          save: async (s) => {
            state = s
          },
        },
        ledger,
        throttle: { run: (fn) => fn() },
        budget: BUDGET,
        signal: new AbortController().signal,
      })
    return { run, calls, state: () => state }
  }

  const throttled = (retryAfterMs?: number) =>
    page([], { cursor: 'c1', rateLimited: retryAfterMs === undefined ? {} : { retryAfterMs } })

  it('a throttled page backs off on the held cursor and never counts as a stall', async () => {
    const cursor = encodeCursor('c1')
    const h = harness({ phase: 'backfill', cursor })
    invokeLambdaExecutor.mockResolvedValue(throttled(2000))

    for (let i = 0; i < 5; i++) {
      expect(await h.run()).toEqual({
        action: 'reenqueue',
        reason: 'retry-held-cursor',
        retryAfterMs: 2000,
      })
      expect(h.state().cursor).toEqual(cursor)
      expect(h.state().noProgressStrikes).toBe(0)
    }
    expect(h.calls).not.toContain('fail')
    for (const [call] of invokeLambdaExecutor.mock.calls) {
      expect(call.payload.cursor).toBe('c1')
    }
  })

  it('without the signal, the same empty page fails the run as a stall', async () => {
    const h = harness({ phase: 'backfill', cursor: encodeCursor('c1') })
    invokeLambdaExecutor.mockResolvedValue(page([], { cursor: 'c1' }))

    expect((await h.run()).action).toBe('reenqueue')
    expect((await h.run()).action).toBe('reenqueue')
    expect((await h.run()).action).toBe('failed')
    expect(h.calls).toContain('fail')
  })

  it('a throttle after progress commits the pages already read and still backs off', async () => {
    const h = harness({ phase: 'backfill' })
    invokeLambdaExecutor
      .mockResolvedValueOnce(page([rec('a')], { cursor: 'c1' }))
      .mockResolvedValueOnce(throttled(1500))

    expect(await h.run()).toEqual({ action: 'reenqueue', reason: 'more-pages', retryAfterMs: 1500 })
    expect(decodeCursor(h.state().cursor)).toBe('c1')
    expect(h.state().noProgressStrikes).toBe(0)
  })

  it('defaults a missing hint and caps an oversized one', async () => {
    const h = harness({ phase: 'backfill', cursor: encodeCursor('c1') })
    invokeLambdaExecutor.mockResolvedValueOnce(throttled())
    expect(await h.run()).toMatchObject({ retryAfterMs: 2_000 })

    invokeLambdaExecutor.mockResolvedValueOnce(throttled(3_600_000))
    expect(await h.run()).toMatchObject({ retryAfterMs: 60_000 })
  })

  it('an expired delta fails the slice with the error the handler restarts on', async () => {
    const h = harness({ phase: 'steady', watermark: JSON.stringify('stale') })
    invokeLambdaExecutor.mockResolvedValueOnce(page([], { deltaExpired: true }))
    const outcome = await h.run()
    expect(outcome.action).toBe('failed')
    expect(outcome.action === 'failed' && outcome.error).toBeInstanceOf(ConnectorDeltaExpiredError)
  })
})
