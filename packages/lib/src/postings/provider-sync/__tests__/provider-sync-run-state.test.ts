// packages/lib/src/postings/provider-sync/__tests__/provider-sync-run-state.test.ts
//
// The state store and the run ledger fold into ONE settings blob, so the
// interesting failures are all about what the fold keeps: a key the core does
// not own, a replayed slice's counters, and the heartbeat a dead chain stops
// bumping (brief 55 §4.4, §4.5, §7.4).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSyncStateBlob } from '../client'
import {
  createProviderSyncRunLedger,
  createProviderSyncStateStore,
  readProviderSyncRunState,
} from '../run-state'

// The settings-store seam, in memory. `run-state-io` is the only thing in the
// module that touches a database.
const stored = vi.hoisted(() => ({ blob: undefined as ProviderSyncStateBlob | undefined }))

vi.mock('../run-state-io', () => ({
  loadProviderSyncBlob: vi.fn(async () => stored.blob ?? {}),
  saveProviderSyncBlob: vi.fn(async (_org: string, blob: ProviderSyncStateBlob) => {
    // Round-trip through jsonb so a `Date` or an `undefined` that should not be
    // in the blob cannot survive into the next read.
    stored.blob = JSON.parse(JSON.stringify(blob))
  }),
}))

const ORG = 'org_1'
const RUN_STARTED = new Date('2026-09-16T10:00:00.000Z')

beforeEach(() => {
  stored.blob = undefined
  vi.useRealTimers()
})

describe('createProviderSyncStateStore', () => {
  it('round-trips the core state and starts a never-run org in backfill', async () => {
    const store = createProviderSyncStateStore(ORG)

    expect(await store.load()).toEqual({ phase: 'backfill' })

    await store.save({
      phase: 'steady',
      cursor: { kind: 'token', value: '2026-07' },
      watermark: '2026-07-31',
      recordsSeen: 42,
    })

    expect(await store.load()).toEqual({
      phase: 'steady',
      cursor: { kind: 'token', value: '2026-07' },
      watermark: '2026-07-31',
      recordsSeen: 42,
    })
  })

  it('preserves blob keys the core does not own', async () => {
    stored.blob = { currentRun: undefined, somethingElse: { kept: true } }

    await createProviderSyncStateStore(ORG).save({ phase: 'backfill' })

    expect(stored.blob?.somethingElse).toEqual({ kept: true })
  })

  it('leaves a run recorded by the ledger untouched', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)
    await ledger.recordSlice({ counters: { created: 3 } })

    await createProviderSyncStateStore(ORG).save({
      phase: 'backfill',
      cursor: { kind: 'token', value: '2026-05' },
    })

    expect(stored.blob?.currentRun?.counters.created).toBe(3)
    expect(stored.blob?.sync?.cursor).toEqual({ kind: 'token', value: '2026-05' })
  })
})

describe('createProviderSyncRunLedger', () => {
  it('folds a repeated checkpointKey exactly once', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)
    const entry = { counters: { created: 2, fetched: 10 }, checkpointKey: 'token:2026-06' }

    await ledger.recordSlice(entry)
    await ledger.recordSlice(entry)

    expect(stored.blob?.currentRun?.counters).toMatchObject({ created: 2, fetched: 10 })
  })

  it('folds every slice that carries no checkpointKey', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)

    await ledger.recordSlice({ counters: { created: 1 } })
    await ledger.recordSlice({ counters: { created: 1 } })
    await ledger.recordSlice({ counters: { created: 1 } })

    expect(stored.blob?.currentRun?.counters.created).toBe(3)
  })

  it('bumps the heartbeat on every slice, including a skipped replay', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)
    const entry = { counters: { created: 1 }, checkpointKey: 'token:2026-06' }

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T10:00:05.000Z'))
    await ledger.recordSlice(entry)
    const first = stored.blob?.currentRun?.heartbeatAt

    vi.setSystemTime(new Date('2026-09-16T10:00:20.000Z'))
    await ledger.recordSlice(entry)

    expect(first).toBe('2026-09-16T10:00:05.000Z')
    expect(stored.blob?.currentRun?.heartbeatAt).toBe('2026-09-16T10:00:20.000Z')
    // Still only one fold - the heartbeat is a sign of life, not a fold.
    expect(stored.blob?.currentRun?.counters.created).toBe(1)
  })

  it('finalizes a clean run as completed and a run with failures as partial', async () => {
    const clean = createProviderSyncRunLedger(ORG, RUN_STARTED)
    await clean.recordSlice({ counters: { created: 5 } })
    await clean.finalize()

    expect(stored.blob?.currentRun).toBeUndefined()
    expect(stored.blob?.lastRun?.status).toBe('completed')

    const later = new Date('2026-09-16T11:00:00.000Z')
    const dirty = createProviderSyncRunLedger(ORG, later)
    await dirty.recordSlice({
      counters: { created: 1, failed: 1 },
      errorSample: [{ externalId: 'JE-9', error: 'does not balance', tier: 'rejected' }],
    })
    await dirty.finalize()

    expect(stored.blob?.lastRun?.status).toBe('partial')
    expect(stored.blob?.lastRun?.errorSample).toHaveLength(1)
    expect(stored.blob?.lastRun?.finishedAt).toBeDefined()
  })

  // 🛑 A divergence bumps no counter - nothing failed and nothing was refused -
  // so `failed` alone would close the run as cleanly completed.
  it('finalizes a run carrying a divergence as partial', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)
    await ledger.recordSlice({
      counters: { created: 4 },
      errorSample: [
        { externalId: 'AUXX-JNL-JE0006', error: 'Edited in the provider…', tier: 'diverged' },
      ],
    })
    await ledger.finalize()

    expect(stored.blob?.lastRun?.status).toBe('partial')
    expect(stored.blob?.lastRun?.counters.failed).toBe(0)
  })

  // A deferral is a decision waiting on somebody with `ledgerControl`, not an
  // incompleteness - the same reason `isChunkClean` does not block on one.
  it('finalizes a run carrying only deferrals as completed', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)
    await ledger.recordSlice({
      counters: { created: 4, deferred: 2 },
      errorSample: [{ externalId: '2026-02', error: '2026-02 is closed…', tier: 'skipped' }],
    })
    await ledger.finalize()

    expect(stored.blob?.lastRun?.status).toBe('completed')
  })

  it('holds the sample at the cap rather than growing it into a log', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)
    const sample = (n: number) => ({
      externalId: `AUXX-${n}`,
      error: 'Edited in the provider…',
      tier: 'diverged' as const,
    })

    await ledger.recordSlice({
      errorSample: Array.from({ length: 50 }, (_, i) => sample(i)),
    })
    await ledger.recordSlice({ errorSample: [sample(99)] })

    expect(stored.blob?.currentRun?.errorSample).toHaveLength(50)
    expect(stored.blob?.currentRun?.errorSample.some((s) => s.externalId === 'AUXX-99')).toBe(false)
  })

  it('closes a run as failed with the terminal message', async () => {
    const ledger = createProviderSyncRunLedger(ORG, RUN_STARTED)
    await ledger.recordSlice({ counters: { fetched: 3 } })
    await ledger.fail(new Error('Intuit returned 503'))

    expect(stored.blob?.currentRun).toBeUndefined()
    expect(stored.blob?.lastRun).toMatchObject({
      status: 'failed',
      error: 'Intuit returned 503',
      counters: { fetched: 3 },
    })
  })

  it('keeps one run of history: a new run pushes an abandoned one aside', async () => {
    // A chain killed mid-slice never closes its run (§7.4); the next run must
    // not inherit its counters.
    await createProviderSyncRunLedger(ORG, RUN_STARTED).recordSlice({ counters: { created: 9 } })

    const next = new Date('2026-09-16T12:00:00.000Z')
    await createProviderSyncRunLedger(ORG, next).recordSlice({ counters: { created: 1 } })

    expect(stored.blob?.currentRun?.startedAt).toBe(next.toISOString())
    expect(stored.blob?.currentRun?.counters.created).toBe(1)
    expect(stored.blob?.lastRun?.counters.created).toBe(9)
    expect(stored.blob?.lastRun?.status).toBe('running')
  })

  it('does not close a run that a later run has taken over', async () => {
    const abandoned = createProviderSyncRunLedger(ORG, RUN_STARTED)
    await abandoned.recordSlice({ counters: { created: 9 } })

    const next = new Date('2026-09-16T12:00:00.000Z')
    await createProviderSyncRunLedger(ORG, next).recordSlice({ counters: { created: 1 } })
    await abandoned.finalize()

    expect(stored.blob?.currentRun?.startedAt).toBe(next.toISOString())
    expect(stored.blob?.lastRun?.status).toBe('running')
  })
})

describe('readProviderSyncRunState', () => {
  it('hands the panel the whole blob', async () => {
    await createProviderSyncRunLedger(ORG, RUN_STARTED).recordSlice({ counters: { created: 1 } })

    const result = await readProviderSyncRunState(ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().currentRun?.status).toBe('running')
  })
})
