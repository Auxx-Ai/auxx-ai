// packages/lib/src/data-connectors/connectors/app-connector-adapter.test.ts
// Coverage for the app-connector adapter's pagination loop (Step 11): each
// `execute` is one page, the adapter loops it and emits a checkpoint after each,
// translating the engine's structured `SyncCursor` ↔ the app's flat cursor. Also
// proves the chain RESUMES across slices via `runConnectorSlice` (the thing the
// pre-Step-11 single-shot adapter broke). The lambda cluster + org cache + the
// connection resolver are mocked (the adapter lazy-imports them at fetch time).

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SliceBudget, SyncCursor, SyncSliceCtx } from '../../sync-core/contracts'
import { runConnectorSlice } from '../connector-slice-loop'
import { type AppConnectorContext, appConnectorAdapter } from './app-connector-adapter'
import { decodeCursor } from './app-connector-state'
import { type ConnectorRecord, type ConnectorYield, isConnectorCheckpoint } from './types'

const invokeLambdaExecutor = vi.fn()
const prepareLambdaContext = vi.fn((x: unknown) => x)
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
          displayFieldKey: 'name',
          fields: [{ fieldKey: 'name', sourcePath: 'name', type: 'TEXT', name: 'Name' }],
          defaultMappings: [],
          exampleRecord: {},
        },
      ],
    },
  ],
}

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    get: async (_org: string, key: string) => {
      if (key === 'installedApps') return [INSTALLED_APP]
      if (key === 'orgProfile') return { handle: 'acme', name: 'Acme' }
      return undefined
    },
  }),
}))

vi.mock('../../apps/lambda', () => ({
  invokeLambdaExecutor: (...args: unknown[]) => invokeLambdaExecutor(...args),
  prepareLambdaContext: (...args: unknown[]) => prepareLambdaContext(...args),
}))

vi.mock('../../apps/connections/resolve-app-connection-for-runtime', () => ({
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
function page(records: ConnectorRecord[], nextState: Record<string, unknown>) {
  return ok({ execution_result: { records, nextState } })
}

/** Drive the adapter's fetch and collect everything the generator yields. */
async function drain(state: Record<string, unknown> = {}): Promise<ConnectorYield[]> {
  const { records } = await appConnectorAdapter('app:test', ctx()).fetch({
    streamKey: 'thing',
    mode: 'snapshot',
    state: state as never,
    credential: null,
    config: {} as never,
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
      .mockResolvedValueOnce(
        page([rec('c')], { backfillComplete: true, updatedSince: '2024-01-01' })
      )

    const yields = await drain()

    // Records interleaved with checkpoints.
    const records = yields.filter((y) => !isConnectorCheckpoint(y)) as ConnectorRecord[]
    expect(records.map((r) => r.externalId)).toEqual(['a', 'b', 'c'])

    const checkpoints = yields.filter(isConnectorCheckpoint)
    expect(checkpoints).toHaveLength(3)
    // Two non-terminal (token-encoded cursors) + one terminal (no cursor).
    expect(checkpoints[0]!.cursor?.kind).toBe('token')
    expect(decodeCursor(checkpoints[0]!.cursor)).toBe('c1')
    expect(decodeCursor(checkpoints[1]!.cursor)).toBe('c2')
    expect(checkpoints[2]!.cursor).toBeUndefined()
    // Terminal checkpoint carries the watermark.
    expect(checkpoints[2]!.watermark).toBe('2024-01-01')

    expect(invokeLambdaExecutor).toHaveBeenCalledTimes(3)
  })

  it('single-batch app → one terminal checkpoint, no resume checkpoint', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(
      page([rec('a'), rec('b')], { backfillComplete: true })
    )

    const yields = await drain()
    const checkpoints = yields.filter(isConnectorCheckpoint)
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]!.cursor).toBeUndefined()
    expect(invokeLambdaExecutor).toHaveBeenCalledTimes(1)
  })

  it('treats a missing cursor (no backfillComplete) as terminal', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')], { updatedSince: '2024-02-02' }))
    const yields = await drain()
    const checkpoints = yields.filter(isConnectorCheckpoint)
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]!.cursor).toBeUndefined()
    expect(checkpoints[0]!.watermark).toBe('2024-02-02')
  })

  it('rides nextState.updatedSince onto a non-terminal checkpoint watermark', async () => {
    invokeLambdaExecutor
      .mockResolvedValueOnce(page([rec('a')], { cursor: 'c1', updatedSince: '2024-03-03' }))
      .mockResolvedValueOnce(page([rec('b')], { backfillComplete: true }))
    const yields = await drain()
    const checkpoints = yields.filter(isConnectorCheckpoint)
    expect(checkpoints[0]!.watermark).toBe('2024-03-03')
  })

  describe('inbound resume translation (engine SyncCursor → flat app cursor)', () => {
    it('decodes a structured backfillCursor into state.cursor for the first invoke', async () => {
      invokeLambdaExecutor.mockResolvedValueOnce(page([], { backfillComplete: true }))
      const backfillCursor: SyncCursor = { kind: 'token', value: JSON.stringify({ after: 'c2' }) }
      await drain({ backfillCursor, watermark: '2024-04-04' })

      const payload = invokeLambdaExecutor.mock.calls[0]![0].payload
      expect(payload.state.cursor).toEqual({ after: 'c2' })
      expect(payload.state.updatedSince).toBe('2024-04-04')
    })

    it('round-trips a plain-string cursor', async () => {
      invokeLambdaExecutor.mockResolvedValueOnce(page([], { backfillComplete: true }))
      await drain({ backfillCursor: { kind: 'token', value: '"c2"' } })
      expect(invokeLambdaExecutor.mock.calls[0]![0].payload.state.cursor).toBe('c2')
    })
  })

  it('forwards the resolved connection (incl. metadata) into the lambda context', async () => {
    invokeLambdaExecutor.mockResolvedValueOnce(page([], { backfillComplete: true }))
    await drain()
    const lambdaArgs = prepareLambdaContext.mock.calls[0]![0] as {
      organizationConnection: { metadata: unknown }
    }
    expect(lambdaArgs.organizationConnection.metadata).toEqual(RESOLVED_METADATA)
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
      mode: 'snapshot',
      state: resume as never,
      credential: null,
      config: {} as never,
    })

  it('slice 1 yields hasMore + page-1 cursor; slice 2 seeded with it advances', async () => {
    // Slice 1 consumes one page (maxPages:1 → bounds at the first checkpoint).
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('a')], { cursor: 'c1' }))
    const slice1 = await runConnectorSlice({
      fetch: sliceFetch(),
      sink: async () => {},
      ctx: sliceCtx(),
      now: () => 0,
    })
    expect(slice1.hasMore).toBe(true)
    expect(decodeCursor(slice1.nextCursor)).toBe('c1')

    // Slice 2 reseeds with slice 1's cursor → the app's execute sees state.cursor 'c1'.
    invokeLambdaExecutor.mockResolvedValueOnce(page([rec('b')], { backfillComplete: true }))
    const slice2 = await runConnectorSlice({
      fetch: sliceFetch(),
      sink: async () => {},
      ctx: sliceCtx({ cursor: slice1.nextCursor }),
      now: () => 0,
    })
    expect(slice2.hasMore).toBe(false)
    expect(invokeLambdaExecutor.mock.calls[1]![0].payload.state.cursor).toBe('c1')
  })
})
