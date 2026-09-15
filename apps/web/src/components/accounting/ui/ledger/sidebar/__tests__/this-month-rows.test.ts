// apps/web/src/components/accounting/ui/ledger/sidebar/__tests__/this-month-rows.test.ts
//
// The "This month" rows (brief 28 §6).
//
// 🛑 What this file pins is mostly a NEGATIVE: no row is an alarm, a type
// with nothing to say has no row, a count that could not be read says nothing
// rather than "0", and no "next" is printed before the browser clock is known.
// The positive half is that every word comes off the declared policy.

import { describe, expect, it } from 'vitest'
import { formatDateKey, type MonthActivityInput, thisMonthRows } from '../this-month-rows'

const NOW = new Date('2026-09-14T01:00:00Z')

function activity(overrides: Partial<MonthActivityInput> = {}): MonthActivityInput {
  return { byType: [], unpostedShipments: 0, unpostedCreditMemos: 0, ...overrides }
}

describe('thisMonthRows', () => {
  it('prints a count and the last txn date for a type that posted', () => {
    const rows = thisMonthRows(
      activity({ byType: [{ postingType: 'fulfillment', count: 12, lastTxnDate: '2026-09-13' }] }),
      null
    )

    expect(rows.find((row) => row.type === 'fulfillment')).toEqual({
      type: 'fulfillment',
      label: 'Fulfillment',
      entries: '12 entries, last Sep 13',
      next: null,
      waiting: null,
    })
  })

  it('reads "1 entry" in the singular', () => {
    const rows = thisMonthRows(
      activity({ byType: [{ postingType: 'write_off', count: 1, lastTxnDate: '2026-09-02' }] }),
      null
    )
    expect(rows.find((row) => row.type === 'write_off')?.entries).toBe('1 entry, last Sep 2')
  })

  it('always shows an enabled scheduled type, with its next fire once the clock is known', () => {
    const payout = thisMonthRows(activity(), NOW).find((row) => row.type === 'payout')

    expect(payout).toEqual({
      type: 'payout',
      label: 'Payout',
      entries: 'No entries yet',
      next: 'today 04:30 UTC',
      waiting: null,
    })
  })

  it('prints no "next" before the browser clock is read', () => {
    const payout = thisMonthRows(activity(), null).find((row) => row.type === 'payout')
    expect(payout?.next).toBeNull()
  })

  it('shows the recurring journal sweep before it posts, now that it is enabled', () => {
    // Enabled 2026-09-14 (brief 28 §10 decision 5); its cron is 03:45 UTC and
    // NOW is 01:00 UTC, so the next fire is later today.
    const row = thisMonthRows(activity(), NOW).find((row) => row.type === 'recurring_journal')
    expect(row).toEqual({
      type: 'recurring_journal',
      label: 'Recurring journal',
      entries: 'No entries yet',
      next: 'today 03:45 UTC',
      waiting: null,
    })
  })

  it('does not show a disabled type that did not post', () => {
    // provider_sync is declared `enabled: false` (policy.ts): the Sync button
    // writes it, not a close, and with nothing synced this month it has no row.
    const rows = thisMonthRows(activity(), NOW)
    expect(rows.find((row) => row.type === 'provider_sync')).toBeUndefined()
  })

  it('still shows a disabled type when it POSTED: what landed is a fact', () => {
    const rows = thisMonthRows(
      activity({
        byType: [{ postingType: 'provider_sync', count: 3, lastTxnDate: '2026-09-01' }],
      }),
      null
    )
    expect(rows.find((row) => row.type === 'provider_sync')?.entries).toBe('3 entries, last Sep 1')
  })

  it('hangs the waiting shipments under Fulfillment, even with nothing posted yet', () => {
    const rows = thisMonthRows(activity({ unpostedShipments: 2 }), null)
    const fulfillment = rows.find((row) => row.type === 'fulfillment')

    expect(fulfillment?.entries).toBe('No entries yet')
    expect(fulfillment?.waiting).toBe('2 shipments waiting for the dialog')
  })

  it('reads one waiting shipment in the singular', () => {
    const rows = thisMonthRows(activity({ unpostedShipments: 1 }), null)
    expect(rows.find((row) => row.type === 'fulfillment')?.waiting).toBe(
      '1 shipment waiting for the dialog'
    )
  })

  it('hangs the waiting credit memos under Credit memo', () => {
    const rows = thisMonthRows(activity({ unpostedCreditMemos: 3 }), null)
    expect(rows.find((row) => row.type === 'credit_memo')?.waiting).toBe(
      '3 issued, waiting for the dialog'
    )
  })

  it('says nothing about a waiting count that could not be read', () => {
    const rows = thisMonthRows(
      activity({ unpostedShipments: null, unpostedCreditMemos: null }),
      null
    )
    expect(rows.find((row) => row.type === 'fulfillment')).toBeUndefined()
    expect(rows.find((row) => row.type === 'credit_memo')).toBeUndefined()
  })

  it('gives a type with nothing to say no row at all', () => {
    const rows = thisMonthRows(activity(), NOW)
    // Only the two enabled scheduled types survive on an empty month.
    expect(rows.map((row) => row.type)).toEqual(['payout', 'recurring_journal'])
  })

  it('orders rows by policy declaration, not by the read', () => {
    const rows = thisMonthRows(
      activity({
        byType: [
          { postingType: 'write_off', count: 1, lastTxnDate: '2026-09-02' },
          { postingType: 'fulfillment', count: 4, lastTxnDate: '2026-09-10' },
        ],
      }),
      null
    )
    expect(rows.map((row) => row.type)).toEqual([
      'fulfillment',
      'payout',
      'write_off',
      'recurring_journal',
    ])
  })
})

describe('formatDateKey', () => {
  it('formats the calendar day the key names, with no zone shift', () => {
    expect(formatDateKey('2026-09-01')).toBe('Sep 1')
    expect(formatDateKey('2026-12-31')).toBe('Dec 31')
  })

  it('returns anything that is not a date key unchanged', () => {
    expect(formatDateKey('JNL-0007')).toBe('JNL-0007')
  })
})
