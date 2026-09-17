// packages/lib/src/postings/provider-sync/__tests__/provider-sync-door-refuses-a-rival-walk.test.ts
//
// §4.6.1, end to end. `markerBlockedRun` is keyed on `runStartedAt`, and
// correctly so - a LATER run must start unblocked or one bad month pins the
// marker for ever. The consequence is that a SECOND concurrent run is not
// blocked by the first one's unclean June, so if it reads a clean July it
// advances `accounting.providerSyncedThrough` straight past a month nothing ever
// brought across. `jobId` does not stop it (the first job is gone by then) and
// the worker's `concurrency: 1` does not either (it is per process). The door's
// refusal is what does.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../errors'
import type { SyncSliceCtx } from '../../../sync-core/contracts'
import type { ProviderSyncStateBlob } from '../client'
import { enqueueProviderSync } from '../queue'
import { blockMarkerForRun, createProviderSyncRunLedger, isMarkerBlockedForRun } from '../run-state'
import { createProviderLedgerSyncSource } from '../sync-source'
import { balancedEntryLines, ledger } from './support/fixtures'

const recordProviderSyncedThrough = vi.hoisted(() => vi.fn())
const fetchBatch = vi.hoisted(() => vi.fn())
const postProviderSyncEntry = vi.hoisted(() => vi.fn())
const add = vi.hoisted(() => vi.fn())
/** The stored `providerSync.state` row, in memory. */
const stored = vi.hoisted(() => ({ blob: {} as ProviderSyncStateBlob }))

vi.mock('../marker-writes', () => ({ recordProviderSyncedThrough }))

vi.mock('../run-state-io', () => ({
  loadProviderSyncBlob: vi.fn(async () => structuredClone(stored.blob)),
  saveProviderSyncBlob: vi.fn(async (_org: string, blob: ProviderSyncStateBlob) => {
    stored.blob = structuredClone(blob)
  }),
}))

vi.mock('../../../jobs/queues', () => ({
  Queues: { providerSyncQueue: 'provider-sync' },
  getQueue: vi.fn(() => ({ add })),
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async () => '2025-12'),
}))

vi.mock('../../period-lock', () => ({
  resolvePeriodLock: vi.fn(async () => ({ lockedThroughMonth: null })),
}))

vi.mock('../../book-connections', () => ({
  readActiveBookCompanyId: vi.fn(async () => '9341453857213446'),
}))

vi.mock('../../provider', () => ({
  NONE_PROVIDER_ID: 'none',
  resolveAccountingProvider: vi.fn(async () => ({
    id: 'quickbooks',
    ledgerSlicer: () => ({
      kind: 'ranged' as const,
      firstCursor: (range: { from: string; to: string }) => ({
        kind: 'token' as const,
        value: `${range.from}..${range.to}`,
      }),
      fetchBatch,
    }),
    listAccountMappings: async () => ({
      isErr: () => false,
      value: new Map([
        ['gl_mastercard', '41'],
        ['gl_checking', '35'],
      ]),
    }),
  })),
}))

vi.mock('../reads', () => ({
  readOurProviderEntryIds: vi.fn(async () => ({ isErr: () => false, value: new Set<string>() })),
  readOurPostedEntries: vi.fn(async () => ({ isErr: () => false, value: [] })),
  readSyncedEntriesInRange: vi.fn(async () => ({ isErr: () => false, value: [] })),
}))

vi.mock('../writes', () => ({
  postProviderSyncEntry,
  reverseSyncedEntry: vi.fn(),
}))

const ORG = 'org_1'
const CHAIN_1 = new Date('2026-09-16T10:00:00.000Z')
const db = {} as never

const CTX: SyncSliceCtx = {
  phase: 'backfill',
  budget: { maxPages: 1, maxRecords: 1000, maxMs: 30_000 },
  throttle: { run: (fn) => fn() },
  signal: new AbortController().signal,
}

function cursor(value: string) {
  return { kind: 'token' as const, value }
}

function batch(value: ReturnType<typeof ledger>, nextMonthStart?: string) {
  return {
    isErr: () => false,
    value: {
      ledger: value,
      hasMore: Boolean(nextMonthStart),
      nextCursor: nextMonthStart ? cursor(`${nextMonthStart}..2026-08-31`) : undefined,
    },
  }
}

/** Half an entry: one leg only, so it can never balance and is never written. */
function uncleanMonth(from: string, to: string, nextMonthStart?: string) {
  return batch(
    ledger(
      balancedEntryLines({ txnType: 'Check', txnId: '104', txnDate: from, amount: 5000 }).slice(
        0,
        1
      ),
      { from, to }
    ),
    nextMonthStart
  )
}

/** One job of a chain: a source built from the RELOADED blob, plus its ledger fold. */
async function runJob(runStartedAt: Date, sliceCursor?: { kind: 'token'; value: string }) {
  const iso = runStartedAt.toISOString()
  const source = await createProviderLedgerSyncSource(db, ORG, {
    from: '2026-06-01',
    to: '2026-08-31',
    markerBlocked: await isMarkerBlockedForRun(ORG, iso),
    onMarkerBlocked: () => blockMarkerForRun(ORG, iso),
  })
  const slice = await source.fetchSlice({ ...CTX, cursor: sliceCursor })
  // What `runSyncSlice` does with the result: the fold is what opens the run and
  // bumps the heartbeat the door reads.
  await createProviderSyncRunLedger(ORG, runStartedAt).recordSlice({
    counters: slice.counters,
    errorSample: slice.errorSample,
  })
  return slice
}

beforeEach(() => {
  stored.blob = {}
  add.mockReset()
  add.mockResolvedValue({ id: 'job_1' })
  fetchBatch.mockReset()
  postProviderSyncEntry.mockReset()
  recordProviderSyncedThrough.mockReset()
  recordProviderSyncedThrough.mockResolvedValue({ isErr: () => false, value: undefined })
  postProviderSyncEntry.mockResolvedValue({ isErr: () => false, value: { status: 'posted' } })
})

describe('a second walk cannot be opened while the first one is still going', () => {
  it('🛑 chain 1 blocks the marker on an unclean June; no chain 2 exists to hop it', async () => {
    fetchBatch.mockResolvedValueOnce(uncleanMonth('2026-06-01', '2026-06-30', '2026-07-01'))

    const june = await runJob(CHAIN_1)

    expect(june.commit).toBe('partial-permanent')
    expect(stored.blob.markerBlockedRun).toBe(CHAIN_1.toISOString())
    expect(stored.blob.currentRun?.status).toBe('running')

    // The press that used to start a rival chain: the first job is long gone, so
    // its `jobId` no longer collapses anything.
    const refusal = await enqueueProviderSync({
      organizationId: ORG,
      to: '2026-08-31',
      trigger: 'pressed',
    }).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(ConflictError)
    expect(add).not.toHaveBeenCalled()
    // Chain 1's block still stands, and nothing else can read a clean July under
    // a fresh `runStartedAt` and vouch for the June it never brought across.
    expect(stored.blob.markerBlockedRun).toBe(CHAIN_1.toISOString())
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()
  })

  it('the rival chain 2 IS what moves the marker past June, if it is ever allowed to exist', async () => {
    // The control. Same unclean June, then a second RUN - a different
    // `runStartedAt`, so `markerBlockedRun` does not apply to it - reading a
    // clean July. The marker jumps to 2026-07-31 over a June nothing imported.
    fetchBatch
      .mockResolvedValueOnce(uncleanMonth('2026-06-01', '2026-06-30', '2026-07-01'))
      .mockResolvedValueOnce(
        batch(
          ledger(
            balancedEntryLines({
              txnType: 'Credit Card Expense',
              txnId: '107',
              txnDate: '2026-07-01',
              amount: 90000,
            }),
            { from: '2026-07-01', to: '2026-07-31' }
          ),
          '2026-08-01'
        )
      )

    const june = await runJob(CHAIN_1)
    await runJob(
      new Date('2026-09-16T10:05:00.000Z'),
      june.nextCursor as { kind: 'token'; value: string }
    )

    expect(recordProviderSyncedThrough).toHaveBeenCalledWith(ORG, '2026-07-31')
  })
})
