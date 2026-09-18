// packages/lib/src/accounting/mirror/__tests__/provider-sync-marker-blocked-across-jobs.test.ts
//
// §7.3, across the seam unit 4 introduced. "Once a chunk of this run came back
// unclean the marker stops" is instance state on the source - and the worker
// builds a fresh source once per JOB, which resets it. June fails in job 6, job
// 7 reads a clean July against a brand new source, and the marker advances past
// the broken June claiming it had been read completely.
//
// So the flag rides in `providerSync.state`, keyed by the run it belongs to: the
// same run stays blocked across jobs, a LATER run starts clean or one bad month
// would pin the marker for ever.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncSliceCtx } from '../../../sync-core/contracts'
import type { ProviderSyncStateBlob } from '../client'
import { blockMarkerForRun, isMarkerBlockedForRun } from '../run-state'
import { createProviderLedgerSyncSource } from '../sync-source'
import { balancedEntryLines, ledger } from './support/fixtures'

const recordProviderSyncedThrough = vi.hoisted(() => vi.fn())
const fetchBatch = vi.hoisted(() => vi.fn())
const translate = vi.hoisted(() => vi.fn())
/** The stored `providerSync.state` row, in memory. */
const stored = vi.hoisted(() => ({ blob: {} as ProviderSyncStateBlob }))

vi.mock('../marker-writes', () => ({ recordProviderSyncedThrough }))

vi.mock('../run-state-io', () => ({
  loadProviderSyncBlob: vi.fn(async () => structuredClone(stored.blob)),
  saveProviderSyncBlob: vi.fn(async (_org: string, blob: ProviderSyncStateBlob) => {
    stored.blob = structuredClone(blob)
  }),
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async () => '2025-12'),
}))

vi.mock('../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: vi.fn(async () => ({ lockedThroughMonth: null })),
}))

vi.mock('../../providers/book-connections', () => ({
  readActiveBookCompanyId: vi.fn(async () => '9341453857213446'),
}))

vi.mock('../../providers/provider', () => ({
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
  readActiveBookId: vi.fn(async () => ({ isErr: () => false, value: 'book_1' })),
  readOurDocNumbers: vi.fn(async () => ({ isErr: () => false, value: new Set<string>() })),
}))

vi.mock('../writes', () => ({
  upsertMirrorChunk: vi.fn(async () => ({
    isErr: () => false,
    value: { mirrored: 0, ours: 0, withdrawn: 0, withdrawnIds: [] },
  })),
}))

vi.mock('../translate', () => ({ translateMirrorRange: translate }))

/** A translation pass that found nothing to do. Overridden per test. */
function cleanTranslation() {
  return {
    isErr: () => false,
    value: {
      written: 0,
      alreadyPosted: 0,
      reversed: 0,
      zeroValue: 0,
      deferredToClosedMonths: [],
      refusals: [],
    },
  }
}

const ORG = 'org_1'
const RUN = '2026-09-16T10:00:00.000Z'
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

function cleanMonth(from: string, to: string, txnId: string, nextMonthStart?: string) {
  return batch(
    ledger(
      balancedEntryLines({ txnType: 'Credit Card Expense', txnId, txnDate: from, amount: 90000 }),
      { from, to }
    ),
    nextMonthStart
  )
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

/**
 * One job of the chain: build a source the way `providerSyncJob` does - from the
 * RELOADED blob - and run exactly one slice.
 */
async function runJob(runStartedAt: string, sliceCursor?: { kind: 'token'; value: string }) {
  const source = await createProviderLedgerSyncSource(db, ORG, {
    from: '2026-06-01',
    to: '2026-08-31',
    markerBlocked: await isMarkerBlockedForRun(ORG, runStartedAt),
    onMarkerBlocked: () => blockMarkerForRun(ORG, runStartedAt),
  })
  return source.fetchSlice({ ...CTX, cursor: sliceCursor })
}

beforeEach(() => {
  stored.blob = {}
  fetchBatch.mockReset()
  translate.mockReset()
  translate.mockResolvedValue(cleanTranslation())
  recordProviderSyncedThrough.mockReset()
  recordProviderSyncedThrough.mockResolvedValue({ isErr: () => false, value: undefined })
})

describe('the marker block survives the source being rebuilt per job', () => {
  it('🛑 a clean July in job N+1 does not vouch for the broken June in job N', async () => {
    fetchBatch
      .mockResolvedValueOnce(uncleanMonth('2026-06-01', '2026-06-30', '2026-07-01'))
      .mockResolvedValueOnce(cleanMonth('2026-07-01', '2026-07-31', '107', '2026-08-01'))

    const june = await runJob(RUN)

    expect(june.commit).toBe('partial-permanent')
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()
    // The block is DURABLE, not just in memory - that is the whole fix.
    expect(stored.blob.markerBlockedRun).toBe(RUN)

    // Job N+1: a brand new source, built from the reloaded blob.
    const july = await runJob(RUN, june.nextCursor as { kind: 'token'; value: string })

    expect(july.commit).toBe('all')
    // July was still mirrored and translated; only the marker is held back.
    expect(translate).toHaveBeenCalledTimes(2)
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()
  })

  it('without the reloaded block, the same July WOULD move the marker', async () => {
    // The control, and the reason the assertion above is not vacuous: an
    // identical second job whose source is built with a cleared flag advances
    // the marker straight past the June it never brought across.
    fetchBatch
      .mockResolvedValueOnce(uncleanMonth('2026-06-01', '2026-06-30', '2026-07-01'))
      .mockResolvedValueOnce(cleanMonth('2026-07-01', '2026-07-31', '107', '2026-08-01'))

    const june = await runJob(RUN)
    const forgetful = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-06-01',
      to: '2026-08-31',
      markerBlocked: false,
    })
    await forgetful.fetchSlice({ ...CTX, cursor: june.nextCursor })

    expect(recordProviderSyncedThrough).toHaveBeenCalledWith(ORG, '2026-07-31')
  })

  it('a LATER run starts unblocked, so one bad month does not pin the marker for ever', async () => {
    fetchBatch
      .mockResolvedValueOnce(uncleanMonth('2026-06-01', '2026-06-30', '2026-07-01'))
      .mockResolvedValueOnce(cleanMonth('2026-06-01', '2026-06-30', '106', '2026-07-01'))

    await runJob(RUN)
    expect(stored.blob.markerBlockedRun).toBe(RUN)

    // A second press, later. Same org, same blob, different run.
    const retry = await runJob('2026-09-17T09:00:00.000Z')

    expect(retry.commit).toBe('all')
    expect(recordProviderSyncedThrough).toHaveBeenCalledWith(ORG, '2026-06-30')
  })

  it('the block is written without dropping anything else in the blob', async () => {
    stored.blob = { sync: { phase: 'backfill', cursor: cursor('2026-06-01..2026-08-31') } }
    fetchBatch.mockResolvedValueOnce(uncleanMonth('2026-06-01', '2026-06-30', '2026-07-01'))

    await runJob(RUN)

    expect(stored.blob.sync?.cursor).toEqual(cursor('2026-06-01..2026-08-31'))
    expect(stored.blob.markerBlockedRun).toBe(RUN)
  })
})
