// packages/lib/src/postings/provider-sync/__tests__/provider-sync-slice-commit.test.ts
//
// §4.2: the three-state `SliceCommit` that replaced one `blocked` boolean.
//
// 🛑 The boolean carried two different failures at once. A provider fault and an
// entry that will never balance both froze the marker and kept the walk reading
// and writing every later month for nothing. The verdicts separate them, and the
// property each one has to hold is the opposite of the other's:
//
//  - a transient fault HOLDS the cursor, so the next slice re-reads the same
//    month and no ground is lost;
//  - a permanent refusal ADVANCES past it, so one unbalanced entry in June does
//    not pin the walk to June forever;
//  - and the MARKER follows neither. It stops at the first unclean chunk of a
//    run and never resumes, because it means "this range has been read
//    completely" and a later clean month cannot vouch for a broken earlier one.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncSliceCtx } from '../../../sync-core/contracts'
import { createProviderLedgerSyncSource } from '../sync-source'
import { balancedEntryLines, ledger } from './support/fixtures'

const recordProviderSyncedThrough = vi.hoisted(() => vi.fn())
const fetchBatch = vi.hoisted(() => vi.fn())
const postProviderSyncEntry = vi.hoisted(() => vi.fn())

vi.mock('../marker-writes', () => ({ recordProviderSyncedThrough }))

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
      nextCursor: nextMonthStart ? cursor(`${nextMonthStart}..2026-03-31`) : undefined,
    },
  }
}

function monthOfTheirWork(from: string, to: string, txnId: string, nextMonthStart?: string) {
  return batch(
    ledger(
      balancedEntryLines({ txnType: 'Credit Card Expense', txnId, txnDate: from, amount: 90000 }),
      { from, to }
    ),
    nextMonthStart
  )
}

/** Half an entry: one leg only, so the entry can never balance and is never written. */
function monthThatWillNeverBalance(from: string, to: string, nextMonthStart?: string) {
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

beforeEach(() => {
  fetchBatch.mockReset()
  postProviderSyncEntry.mockReset()
  recordProviderSyncedThrough.mockReset()
  recordProviderSyncedThrough.mockResolvedValue({ isErr: () => false, value: undefined })
  postProviderSyncEntry.mockResolvedValue({ isErr: () => false, value: { status: 'posted' } })
})

describe("a clean slice commits 'all'", () => {
  it('advances the marker and carries the slicer’s next cursor', async () => {
    fetchBatch.mockResolvedValueOnce(
      monthOfTheirWork('2026-01-01', '2026-01-31', '101', '2026-02-01')
    )
    const source = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-01-01',
      to: '2026-03-31',
    })

    const slice = await source.fetchSlice(CTX)

    expect(slice.commit).toBe('all')
    expect(slice.hasMore).toBe(true)
    expect(slice.nextCursor).toEqual(cursor('2026-02-01..2026-03-31'))
    expect(recordProviderSyncedThrough).toHaveBeenCalledWith(ORG, '2026-01-31')
    expect(source.progress().syncedThrough).toBe('2026-01-31')
  })

  it('reports hasMore false on the last month, so the walk can finish', async () => {
    fetchBatch.mockResolvedValueOnce(monthOfTheirWork('2026-03-01', '2026-03-31', '103'))
    const source = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-01-01',
      to: '2026-03-31',
    })

    const slice = await source.fetchSlice(CTX)

    expect(slice.hasMore).toBe(false)
    expect(slice.nextCursor).toBeUndefined()
    expect(slice.commit).toBe('all')
  })
})

describe("a transient provider fault commits 'partial-retriable'", () => {
  it('🛑 holds the cursor and leaves the marker exactly where it was', async () => {
    fetchBatch.mockResolvedValueOnce({
      isErr: () => true,
      error: new Error('QuickBooks answered 429'),
    })
    const source = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-01-01',
      to: '2026-03-31',
    })

    const slice = await source.fetchSlice({ ...CTX, cursor: cursor('2026-01-01..2026-03-31') })

    expect(slice.commit).toBe('partial-retriable')
    // 🛑 No next cursor. `runSyncSlice` ignores `nextCursor` on a held cursor,
    // but offering one at all would be a lie about what was read.
    expect(slice.nextCursor).toBeUndefined()
    expect(slice.recordsProcessed).toBe(0)
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()
    expect(source.progress().syncedThrough).toBeNull()
    // Nothing was planned and nothing was written - the month was never read.
    expect(postProviderSyncEntry).not.toHaveBeenCalled()
    expect(source.progress().chunks).toHaveLength(0)
    expect(source.lastRetriableFault()?.message).toContain('429')
  })

  it('samples the fault against the cursor it could not read', async () => {
    fetchBatch.mockResolvedValueOnce({ isErr: () => true, error: new Error('socket hang up') })
    const source = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-01-01',
      to: '2026-03-31',
    })

    const slice = await source.fetchSlice({ ...CTX, cursor: cursor('2026-02-01..2026-03-31') })

    expect(slice.errorSample).toEqual([
      { externalId: '2026-02-01..2026-03-31', error: 'socket hang up' },
    ])
    expect(slice.counters?.failed).toBe(1)
  })
})

describe("a month that will never balance commits 'partial-permanent'", () => {
  it('🛑 advances past it, and the walk keeps going', async () => {
    fetchBatch
      .mockResolvedValueOnce(monthThatWillNeverBalance('2026-01-01', '2026-01-31', '2026-02-01'))
      .mockResolvedValueOnce(monthOfTheirWork('2026-02-01', '2026-02-28', '102'))
    const source = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-01-01',
      to: '2026-03-31',
    })

    const first = await source.fetchSlice(CTX)

    expect(first.commit).toBe('partial-permanent')
    // The cursor moves. One unbalanced entry in January must not pin the walk
    // to January on every press for the rest of time.
    expect(first.nextCursor).toEqual(cursor('2026-02-01..2026-03-31'))
    expect(first.counters?.failed).toBe(1)
    expect(first.errorSample?.[0]?.tier).toBe('invalid')
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()

    const second = await source.fetchSlice({ ...CTX, cursor: first.nextCursor })

    // February is clean, and it is still walked and still written.
    expect(second.commit).toBe('all')
    expect(postProviderSyncEntry).toHaveBeenCalledTimes(1)
    // 🛑 But the marker stays put. It means "this range has been read
    // completely", and January was not.
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()
    expect(source.progress().syncedThrough).toBeNull()
  })

  it('a refused write is permanent too, and names the refusal in the sample', async () => {
    postProviderSyncEntry.mockResolvedValueOnce({
      isErr: () => true,
      error: new Error('Account 41 is not mapped'),
    })
    fetchBatch.mockResolvedValueOnce(monthOfTheirWork('2026-01-01', '2026-01-31', '101'))
    const source = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-01-01',
      to: '2026-03-31',
    })

    const slice = await source.fetchSlice(CTX)

    expect(slice.commit).toBe('partial-permanent')
    expect(slice.errorSample).toEqual([
      { externalId: '2026-01-01..2026-01-31', error: 'Account 41 is not mapped', tier: 'rejected' },
    ])
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()
  })
})

describe('the run-scoped reads', () => {
  it('🛑 resolves the exclusion set and the account map ONCE, not per slice', async () => {
    const { readOurProviderEntryIds } = await import('../reads')
    vi.mocked(readOurProviderEntryIds).mockClear()

    fetchBatch
      .mockResolvedValueOnce(monthOfTheirWork('2026-01-01', '2026-01-31', '101', '2026-02-01'))
      .mockResolvedValueOnce(monthOfTheirWork('2026-02-01', '2026-02-28', '102'))
    const source = await createProviderLedgerSyncSource(db, ORG, {
      from: '2026-01-01',
      to: '2026-03-31',
    })
    const first = await source.fetchSlice(CTX)
    await source.fetchSlice({ ...CTX, cursor: first.nextCursor })

    // `readOurProviderEntryIds`' correctness argument - "it cannot change
    // underneath us" - depends on it being read once for the whole walk.
    expect(readOurProviderEntryIds).toHaveBeenCalledTimes(1)
  })
})

describe('the cutover floor', () => {
  it('🛑 refuses before a single batch is fetched', async () => {
    await expect(
      createProviderLedgerSyncSource(db, ORG, { from: '2025-06-01', to: '2026-03-31' })
    ).rejects.toThrow('double')
    expect(fetchBatch).not.toHaveBeenCalled()
  })
})
