// apps/web/src/components/accounting/ui/journal/journal-lines.test.ts

import type { JournalEntryLine } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import {
  computeJournalLineTotals,
  draftRowsFromLines,
  emptyDraftRow,
  type JournalLineDraft,
  linesFromDraftRows,
} from './journal-lines'

function row(overrides: Partial<JournalLineDraft>): JournalLineDraft {
  return { ...emptyDraftRow(), ...overrides }
}

describe('linesFromDraftRows', () => {
  it('drops a row with no account', () => {
    const lines = linesFromDraftRows([row({ accountCode: null, debitMinor: 1000 })])
    expect(lines).toEqual([])
  })

  it('drops a row with neither a debit nor a credit', () => {
    const lines = linesFromDraftRows([row({ accountCode: '6300' })])
    expect(lines).toEqual([])
  })

  it('drops a row whose only amount is zero', () => {
    const lines = linesFromDraftRows([row({ accountCode: '6300', debitMinor: 0, creditMinor: 0 })])
    expect(lines).toEqual([])
  })

  it('reads a debit-only row as a debit line', () => {
    const lines = linesFromDraftRows([row({ accountCode: '6300', debitMinor: 1500 })])
    expect(lines).toEqual([{ accountCode: '6300', direction: 'debit', amountMinor: 1500 }])
  })

  it('reads a credit-only row as a credit line', () => {
    const lines = linesFromDraftRows([row({ accountCode: '2000', creditMinor: 1500 })])
    expect(lines).toEqual([{ accountCode: '2000', direction: 'credit', amountMinor: 1500 }])
  })

  it('prefers debit when a row somehow carries both (exclusivity is UI-enforced, not assumed here)', () => {
    const lines = linesFromDraftRows([
      row({ accountCode: '6300', debitMinor: 500, creditMinor: 500 }),
    ])
    expect(lines).toEqual([{ accountCode: '6300', direction: 'debit', amountMinor: 500 }])
  })

  it('trims and carries a non-empty memo, and omits a blank one', () => {
    const lines = linesFromDraftRows([
      row({ accountCode: '6300', debitMinor: 500, memo: '  shipping  ' }),
      row({ accountCode: '2000', creditMinor: 500, memo: '   ' }),
    ])
    expect(lines[0]?.memo).toBe('shipping')
    expect(lines[1]?.memo).toBeUndefined()
  })
})

describe('draftRowsFromLines / linesFromDraftRows round-trip', () => {
  it('preserves account, direction, amount and memo', () => {
    const lines: JournalEntryLine[] = [
      { accountCode: '6300', direction: 'debit', amountMinor: 2500, memo: 'office supplies' },
      { accountCode: '1000', direction: 'credit', amountMinor: 2500 },
    ]
    const rows = draftRowsFromLines(lines)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ accountCode: '6300', debitMinor: 2500, creditMinor: null })
    expect(rows[1]).toMatchObject({ accountCode: '1000', creditMinor: 2500, debitMinor: null })
    expect(linesFromDraftRows(rows)).toEqual(lines)
  })
})

describe('computeJournalLineTotals', () => {
  it('is balanced and zero on no rows', () => {
    expect(computeJournalLineTotals([])).toEqual({
      debitMinor: 0,
      creditMinor: 0,
      balanced: true,
      differenceMinor: 0,
    })
  })

  it('sums debits and credits independently', () => {
    const totals = computeJournalLineTotals([
      row({ accountCode: '6300', debitMinor: 1000 }),
      row({ accountCode: '6400', debitMinor: 500 }),
      row({ accountCode: '1000', creditMinor: 1500 }),
    ])
    expect(totals).toEqual({
      debitMinor: 1500,
      creditMinor: 1500,
      balanced: true,
      differenceMinor: 0,
    })
  })

  it('names the difference when the sides disagree', () => {
    const totals = computeJournalLineTotals([
      row({ accountCode: '6300', debitMinor: 1000 }),
      row({ accountCode: '1000', creditMinor: 400 }),
    ])
    expect(totals).toEqual({
      debitMinor: 1000,
      creditMinor: 400,
      balanced: false,
      differenceMinor: 600,
    })
  })

  it('ignores an incomplete row (account with no amount yet)', () => {
    const totals = computeJournalLineTotals([
      row({ accountCode: '6300', debitMinor: 1000 }),
      row({ accountCode: '1000' }),
    ])
    expect(totals.balanced).toBe(false)
    expect(totals.differenceMinor).toBe(1000)
  })
})
