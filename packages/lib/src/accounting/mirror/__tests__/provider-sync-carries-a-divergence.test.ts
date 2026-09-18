// packages/lib/src/accounting/mirror/__tests__/provider-sync-carries-a-divergence.test.ts
//
// §5.3's detector, all the way to the run blob.
//
// 🛑 The comparison is the ONLY thing that can see an entry auxx authored and
// the accountant then edited: `isOurs` keys on authorship, an edit does not
// transfer authorship, so the entry is invisible to the write path and the read
// path at once. A detector whose output is computed and dropped is worse than no
// detector, because the code implies a safety net that reports nothing - so what
// these tests pin is the CARRIAGE, not the verdict (that is
// `provider-sync-detects-an-edit.test.ts`).
//
// `errorSample` is the only per-entry channel the core carries from a slice to
// the run, and `tier` is what keeps the three things riding it apart.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncSliceCtx } from '../../../sync-core/contracts'
import { OUR_PROVIDER_TXN_TYPE } from '../client'
import { createProviderLedgerSyncSource } from '../sync-source'
import { accountMap, balancedEntryLines, ledger, ourEntry } from './support/fixtures'

const fetchBatch = vi.hoisted(() => vi.fn())
const readOurPostedEntries = vi.hoisted(() => vi.fn())
const resolvePeriodLock = vi.hoisted(() => vi.fn())

const translate = vi.hoisted(() => vi.fn())

vi.mock('../marker-writes', () => ({
  recordProviderSyncedThrough: vi.fn(async () => ({ isErr: () => false, value: undefined })),
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async () => '2025-12'),
}))

vi.mock('../../../postings/period-lock', () => ({ resolvePeriodLock }))

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
    listAccountMappings: async () => ({ isErr: () => false, value: accountMap() }),
  })),
}))

vi.mock('../reads', () => ({
  readOurProviderEntryIds: vi.fn(async () => ({ isErr: () => false, value: new Set(['6']) })),
  readOurPostedEntries,
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
const db = {} as never

const CTX: SyncSliceCtx = {
  phase: 'backfill',
  budget: { maxPages: 1, maxRecords: 1000, maxMs: 30_000 },
  throttle: { run: (fn) => fn() },
  signal: new AbortController().signal,
}

/** Their copy of OUR journal entry `6`, at whatever amount the accountant left it. */
function theirCopyOfOurs(amount: number) {
  return {
    isErr: () => false,
    value: {
      ledger: ledger(
        balancedEntryLines({
          txnType: OUR_PROVIDER_TXN_TYPE,
          txnId: '6',
          txnDate: '2026-02-15',
          amount,
        }),
        { from: '2026-02-01', to: '2026-02-28' }
      ),
      hasMore: false,
    },
  }
}

function ourCopy() {
  return { providerEntryId: '6', docNumber: 'AUXX-JNL-JE0006' }
}

async function sliceOnce() {
  const source = await createProviderLedgerSyncSource(db, ORG, {
    from: '2026-02-01',
    to: '2026-02-28',
  })
  return source.fetchSlice(CTX)
}

beforeEach(() => {
  fetchBatch.mockReset()
  readOurPostedEntries.mockReset()
  translate.mockReset()
  translate.mockResolvedValue(cleanTranslation())
  resolvePeriodLock.mockReset()
  resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  readOurPostedEntries.mockResolvedValue({ isErr: () => false, value: [ourEntry(ourCopy())] })
})

describe('an edited entry of ours', () => {
  it('reaches the blob as a diverged sample naming the doc number and both versions', async () => {
    // The accountant opened AUXX-JNL-JE0006 and changed 900.00 to 1,500.00.
    fetchBatch.mockResolvedValueOnce(theirCopyOfOurs(150000))

    const slice = await sliceOnce()

    const diverged = slice.errorSample?.filter((sample) => sample.tier === 'diverged') ?? []
    expect(diverged).toHaveLength(1)
    expect(diverged[0]?.externalId).toBe('AUXX-JNL-JE0006')
    expect(diverged[0]?.error).toContain('Edited in the provider')
    // The differences verbatim, both versions named - not "these differ".
    expect(diverged[0]?.error).toContain('$900.00')
    expect(diverged[0]?.error).toContain('$1,500.00')
  })

  it('🛑 does not make the chunk a failure - nothing was refused and the cursor advances', async () => {
    fetchBatch.mockResolvedValueOnce(theirCopyOfOurs(150000))

    const slice = await sliceOnce()

    expect(slice.commit).toBe('all')
    expect(slice.counters?.failed).toBe(0)
  })
})

describe('an entry of ours that has vanished from their ledger', () => {
  it("carries the 'missing' verdict, because our books still hold it", async () => {
    // A month of theirs that simply does not contain transaction 6 any more.
    fetchBatch.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        ledger: ledger([], { from: '2026-02-01', to: '2026-02-28' }),
        hasMore: false,
      },
    })

    const slice = await sliceOnce()

    const diverged = slice.errorSample?.filter((sample) => sample.tier === 'diverged') ?? []
    expect(diverged).toHaveLength(1)
    expect(diverged[0]?.error).toContain('Gone from the provider')
    expect(diverged[0]?.error).toContain('still in our books')
  })
})

describe("a 'matches' verdict", () => {
  // ⚠️ The ordinary case. Carrying it would bury the two that matter under a
  // line per entry per month, and turn a clean run into a partial one.
  it('carries nothing at all', async () => {
    fetchBatch.mockResolvedValueOnce(theirCopyOfOurs(90000))

    const slice = await sliceOnce()

    expect(slice.errorSample).toBeUndefined()
    expect(slice.commit).toBe('all')
  })
})

describe('a deferral to a closed month', () => {
  it('carries the month and the action, not just the count', async () => {
    resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-02' })
    readOurPostedEntries.mockResolvedValue({ isErr: () => false, value: [] })
    // The deferral is `translate.ts`'s decision; this file is about what
    // reaches the run's blob once it has been made.
    translate.mockResolvedValue({
      isErr: () => false,
      value: {
        written: 0,
        alreadyPosted: 0,
        reversed: 0,
        zeroValue: 0,
        deferredToClosedMonths: [
          {
            month: '2026-02',
            txnType: 'Credit Card Expense',
            txnId: '77',
            txnDate: '2026-02-15',
            totalMinor: 4500,
            action: 'write',
          },
        ],
        refusals: [],
      },
    })
    fetchBatch.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        ledger: ledger(
          balancedEntryLines({
            txnType: 'Credit Card Expense',
            txnId: '77',
            txnDate: '2026-02-15',
            amount: 4500,
          }),
          { from: '2026-02-01', to: '2026-02-28' }
        ),
        hasMore: false,
      },
    })

    const slice = await sliceOnce()

    const deferred = slice.errorSample?.filter((sample) => sample.tier === 'skipped') ?? []
    expect(deferred).toHaveLength(1)
    expect(deferred[0]?.externalId).toBe('2026-02')
    expect(deferred[0]?.error).toContain('Credit Card Expense 77')
    expect(deferred[0]?.error).toContain('not written')
    expect(slice.counters?.deferred).toBe(1)
    // 🛑 A deferral is a decision waiting on a person, never a fault.
    expect(slice.commit).toBe('all')
    expect(slice.counters?.failed).toBe(0)
  })
})
