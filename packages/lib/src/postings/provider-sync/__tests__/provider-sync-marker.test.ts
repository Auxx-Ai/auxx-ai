// packages/lib/src/postings/provider-sync/__tests__/provider-sync-marker.test.ts
//
// §7.3's "synced through" marker, from both ends.
//
// 🛑 **The property under test is that the marker never runs ahead of what was
// genuinely read.** The firm posts December's depreciation in February, so
// auxx's December balance sheet is incomplete until the sync passes over it and
// then it changes. A marker that advanced past a chunk which refused an entry
// would tell the reader that month HAD been read, which is the one direction in
// which this value must never be wrong: it would take a statement that quietly
// changes and give it a badge saying it will not.
//
// The other half is the rendering, which is pure, so the three states a reader
// can be in are asserted directly rather than through a component.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeProviderSyncCoverage, type ProviderSyncMarker } from '../client'
import { syncProviderLedger } from '../sync'
import { balancedEntryLines, ledger } from './support/fixtures'

const recordProviderSyncedThrough = vi.hoisted(() => vi.fn())
const readProviderLedger = vi.hoisted(() => vi.fn())
const postProviderSyncEntry = vi.hoisted(() => vi.fn())

vi.mock('../marker-writes', () => ({ recordProviderSyncedThrough }))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async () => '2025-12'),
}))

vi.mock('../../period-lock', () => ({
  resolvePeriodLock: vi.fn(async () => ({ lockedThroughMonth: null })),
}))

vi.mock('../../provider', () => ({
  NONE_PROVIDER_ID: 'none',
  resolveAccountingProvider: vi.fn(async () => ({
    id: 'quickbooks',
    readProviderLedger,
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

/** One month of their work, dated inside the chunk it is answered for. */
function monthOfTheirWork(from: string, to: string, txnId: string) {
  return {
    isErr: () => false,
    value: ledger(
      balancedEntryLines({ txnType: 'Credit Card Expense', txnId, txnDate: from, amount: 90000 }),
      { from, to }
    ),
  }
}

beforeEach(() => {
  readProviderLedger.mockReset()
  postProviderSyncEntry.mockReset()
  recordProviderSyncedThrough.mockReset()
  recordProviderSyncedThrough.mockResolvedValue({ isErr: () => false, value: undefined })
  postProviderSyncEntry.mockResolvedValue({ isErr: () => false, value: { status: 'posted' } })
})

describe('the marker advances', () => {
  it('stamps the end of every chunk that came back clean', async () => {
    readProviderLedger
      .mockResolvedValueOnce(monthOfTheirWork('2026-01-01', '2026-01-31', '101'))
      .mockResolvedValueOnce(monthOfTheirWork('2026-02-01', '2026-02-28', '102'))

    const result = await syncProviderLedger(db, ORG, { from: '2026-01-01', to: '2026-02-28' })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().syncedThrough).toBe('2026-02-28')
    // Chunk by chunk, not once at the end: a provider fault on a later month
    // has to keep every month already brought across.
    expect(recordProviderSyncedThrough.mock.calls.map((call) => call[1])).toEqual([
      '2026-01-31',
      '2026-02-28',
    ])
  })

  it('advances over an EMPTY month - a quiet month is a real answer, not a fault', async () => {
    readProviderLedger.mockResolvedValueOnce({
      isErr: () => false,
      value: ledger([], { from: '2026-01-01', to: '2026-01-31', hasData: false }),
    })

    const result = await syncProviderLedger(db, ORG, { from: '2026-01-01', to: '2026-01-31' })

    expect(result._unsafeUnwrap().syncedThrough).toBe('2026-01-31')
    expect(recordProviderSyncedThrough).toHaveBeenCalledWith(ORG, '2026-01-31')
  })
})

describe('the marker does NOT advance', () => {
  it('🛑 stops at a chunk that refused an entry, and never resumes past it', async () => {
    readProviderLedger
      .mockResolvedValueOnce(monthOfTheirWork('2026-01-01', '2026-01-31', '101'))
      .mockResolvedValueOnce(monthOfTheirWork('2026-02-01', '2026-02-28', '102'))
      .mockResolvedValueOnce(monthOfTheirWork('2026-03-01', '2026-03-31', '103'))
    // February's entry is declined; January's and March's are written.
    postProviderSyncEntry
      .mockResolvedValueOnce({ isErr: () => false, value: { status: 'posted' } })
      .mockResolvedValueOnce({ isErr: () => true, error: new Error('Account 41 is not mapped') })
      .mockResolvedValueOnce({ isErr: () => false, value: { status: 'posted' } })

    const result = await syncProviderLedger(db, ORG, { from: '2026-01-01', to: '2026-03-31' })

    const outcome = result._unsafeUnwrap()
    expect(outcome.refusals).toHaveLength(1)
    // 🛑 NOT '2026-03-31'. A clean March cannot vouch for a broken February,
    // and a marker that hopped over it would claim February had been read.
    expect(outcome.syncedThrough).toBe('2026-01-31')
    expect(recordProviderSyncedThrough.mock.calls.map((call) => call[1])).toEqual(['2026-01-31'])
  })

  it('🛑 stops at a chunk holding an entry that did not balance', async () => {
    // An unbalanced entry is never written, so the chunk is PARTIAL even though
    // nothing refused: an entry that exists on their side is not in our books.
    const halfAnEntry = balancedEntryLines({
      txnType: 'Check',
      txnId: '104',
      txnDate: '2026-01-10',
      amount: 5000,
    }).slice(0, 1)
    readProviderLedger.mockResolvedValueOnce({
      isErr: () => false,
      value: ledger(halfAnEntry, { from: '2026-01-01', to: '2026-01-31' }),
    })

    const result = await syncProviderLedger(db, ORG, { from: '2026-01-01', to: '2026-01-31' })

    expect(result._unsafeUnwrap().syncedThrough).toBeNull()
    expect(recordProviderSyncedThrough).not.toHaveBeenCalled()
  })

  it('leaves the stored value alone when the stamp itself fails', async () => {
    readProviderLedger.mockResolvedValueOnce(monthOfTheirWork('2026-01-01', '2026-01-31', '101'))
    recordProviderSyncedThrough.mockResolvedValue({
      isErr: () => true,
      error: new Error('settings unavailable'),
    })

    const result = await syncProviderLedger(db, ORG, { from: '2026-01-01', to: '2026-01-31' })

    // The entries are written and the ledger is right, so this is not a refusal
    // of the sync - but the reported marker matches what is actually stored
    // rather than what we wished we had stored.
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().syncedThrough).toBeNull()
  })
})

describe('what a statement reads', () => {
  const connected: ProviderSyncMarker = {
    connected: true,
    providerId: 'quickbooks',
    syncedThrough: '2026-11-30',
  }

  it('🛑 renders nothing at all for an org with no provider', () => {
    const reading = describeProviderSyncCoverage(
      { connected: false, providerId: 'none', syncedThrough: null },
      '2026-12-31'
    )
    // Not "synced through: never", not an empty marker. Meaningless there, and
    // it would imply a connection exists.
    expect(reading.coverage).toBe('not_connected')
    expect(reading.headline).toBeNull()
    expect(reading.detail).toBeNull()
  })

  it('🛑 says a 31 December statement is incomplete on an org synced through 30 November', () => {
    const reading = describeProviderSyncCoverage(connected, '2026-12-31')

    expect(reading.coverage).toBe('behind')
    expect(reading.headline).toBe('Incomplete after 2026-11-30')
    // The most useful thing the feature can say: what is missing, and that the
    // figures will change - not just a date the reader has to compare by hand.
    expect(reading.detail).toContain('2026-12-31')
    expect(reading.detail).toContain('QuickBooks')
    expect(reading.detail).toContain('will change')
  })

  it('confirms quietly when the marker reaches the end of the range', () => {
    expect(describeProviderSyncCoverage(connected, '2026-11-30')).toEqual({
      coverage: 'current',
      headline: 'Synced through 2026-11-30',
      detail: null,
    })
    // A statement ending BEFORE the marker is covered too.
    expect(describeProviderSyncCoverage(connected, '2026-06-30').coverage).toBe('current')
  })

  it('names the never-synced case separately - everything of theirs is missing', () => {
    const reading = describeProviderSyncCoverage(
      { connected: true, providerId: 'quickbooks', syncedThrough: null },
      '2026-12-31'
    )
    expect(reading.coverage).toBe('never_synced')
    expect(reading.headline).toBe('Nothing has been read from QuickBooks yet')
  })

  it('reads a statement with no resolved range as current rather than behind', () => {
    // The page renders nothing while `through` is empty; this is the guard that
    // stops an empty string comparing as "before everything".
    expect(describeProviderSyncCoverage(connected, '').coverage).toBe('current')
  })
})
