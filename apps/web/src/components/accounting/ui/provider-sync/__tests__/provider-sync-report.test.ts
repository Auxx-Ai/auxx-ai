// apps/web/src/components/accounting/ui/provider-sync/__tests__/provider-sync-report.test.ts
//
// The two readings the sync report is built on
// (plans/accounting/tasks/20-two-authors-one-ledger.md §7.3, §7.4).
//
// 🛑 `syncedThrough` short of the `to` that was asked for is the one thing on
// this screen that must be said loudly: it means the walk hit a month it could
// not bring across, latched, and never read the months after it. A report that
// rendered "done" over a half-finished walk would be the trust problem §7.3
// exists to prevent, with the arrows reversed.

import { describe, expect, it } from 'vitest'
import {
  groupDeferredMonths,
  type ProviderSyncOutcome,
  readSyncedThrough,
} from '../provider-sync-report'

function outcome(over: Partial<ProviderSyncOutcome>): ProviderSyncOutcome {
  return {
    from: '2026-01-01',
    to: '2026-11-30',
    providerId: 'quickbooks',
    currency: 'USD',
    chunks: [],
    written: 0,
    alreadyPosted: 0,
    reversed: 0,
    deferredToClosedMonths: [],
    refusals: [],
    syncedThrough: '2026-11-30',
    ...over,
  } as ProviderSyncOutcome
}

describe('readSyncedThrough', () => {
  it('reads the whole range as complete', () => {
    expect(readSyncedThrough(outcome({}))).toBe('complete')
  })

  it('reads a marker behind the requested end as short', () => {
    expect(readSyncedThrough(outcome({ syncedThrough: '2026-03-31' }))).toBe('short')
  })

  // Null is NOT "nothing happened": entries may well have been written. It
  // means no chunk came back clean, so the stored marker was left where it was.
  it('reads a marker that never advanced as its own case', () => {
    expect(readSyncedThrough(outcome({ syncedThrough: null, written: 12 }))).toBe('never_advanced')
  })
})

describe('groupDeferredMonths', () => {
  const deferred = (month: string, action: 'write' | 'reverse', txnId: string) => ({
    month,
    txnType: 'Journal Entry',
    txnId,
    txnDate: `${month}-15`,
    totalMinor: 1000,
    action,
  })

  it('counts writes and reversals separately, oldest month first', () => {
    expect(
      groupDeferredMonths([
        deferred('2026-03', 'write', '1'),
        deferred('2026-01', 'write', '2'),
        deferred('2026-01', 'reverse', '3'),
        deferred('2026-01', 'write', '4'),
      ])
    ).toEqual([
      { month: '2026-01', writes: 2, reverses: 1 },
      { month: '2026-03', writes: 1, reverses: 0 },
    ])
  })

  it('is empty when nothing is waiting on a closed month', () => {
    expect(groupDeferredMonths([])).toEqual([])
  })
})
