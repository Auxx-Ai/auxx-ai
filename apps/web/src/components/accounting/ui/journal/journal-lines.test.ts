// apps/web/src/components/accounting/ui/journal/journal-lines.test.ts

import type { JournalEntryLine } from '@auxx/lib/accounting/journals/client'
import { describe, expect, it } from 'vitest'
import {
  computeJournalLineTotals,
  draftRowsFromLines,
  emptyDraftRow,
  type JournalLineDraft,
  linesFromDraftRows,
  withSavedLineIds,
} from './journal-lines'

function row(overrides: Partial<JournalLineDraft>): JournalLineDraft {
  return { ...emptyDraftRow(), ...overrides }
}

describe('linesFromDraftRows', () => {
  it('drops a row with no account', () => {
    const lines = linesFromDraftRows([row({ glAccountId: null, debitMinor: 1000 })])
    expect(lines).toEqual([])
  })

  it('drops a row with neither a debit nor a credit', () => {
    const lines = linesFromDraftRows([row({ glAccountId: 'acc_6300' })])
    expect(lines).toEqual([])
  })

  it('drops a row whose only amount is zero', () => {
    const lines = linesFromDraftRows([
      row({ glAccountId: 'acc_6300', debitMinor: 0, creditMinor: 0 }),
    ])
    expect(lines).toEqual([])
  })

  it('reads a debit-only row as a debit line', () => {
    const lines = linesFromDraftRows([row({ glAccountId: 'acc_6300', debitMinor: 1500 })])
    expect(lines).toEqual([{ glAccountId: 'acc_6300', direction: 'debit', amountMinor: 1500 }])
  })

  it('reads a credit-only row as a credit line', () => {
    const lines = linesFromDraftRows([row({ glAccountId: 'acc_2000', creditMinor: 1500 })])
    expect(lines).toEqual([{ glAccountId: 'acc_2000', direction: 'credit', amountMinor: 1500 }])
  })

  it('prefers debit when a row somehow carries both (exclusivity is UI-enforced, not assumed here)', () => {
    const lines = linesFromDraftRows([
      row({ glAccountId: 'acc_6300', debitMinor: 500, creditMinor: 500 }),
    ])
    expect(lines).toEqual([{ glAccountId: 'acc_6300', direction: 'debit', amountMinor: 500 }])
  })

  it('trims and carries a non-empty memo, and omits a blank one', () => {
    const lines = linesFromDraftRows([
      row({ glAccountId: 'acc_6300', debitMinor: 500, memo: '  shipping  ' }),
      row({ glAccountId: 'acc_2000', creditMinor: 500, memo: '   ' }),
    ])
    expect(lines[0]?.memo).toBe('shipping')
    expect(lines[1]?.memo).toBeUndefined()
  })

  // Brief 13 §1.4: the grid's counterparty is nullable, the wire shape's is
  // optional - the two must not disagree on an empty row.
  it('carries a well-formed counterparty through, and omits it when absent', () => {
    const lines = linesFromDraftRows([
      row({
        glAccountId: 'acc_1100',
        debitMinor: 500,
        counterpartyType: 'customer',
        counterpartyId: 'contact_1',
      }),
      row({ glAccountId: 'acc_2000', creditMinor: 500 }),
    ])
    expect(lines[0]).toMatchObject({ counterpartyType: 'customer', counterpartyId: 'contact_1' })
    expect(lines[1]).not.toHaveProperty('counterpartyType')
    expect(lines[1]).not.toHaveProperty('counterpartyId')
  })

  it('drops a counterparty type with no id, and vice versa', () => {
    const lines = linesFromDraftRows([
      row({ glAccountId: 'acc_1100', debitMinor: 500, counterpartyType: 'customer' }),
      row({ glAccountId: 'acc_2000', creditMinor: 500, counterpartyId: 'contact_1' }),
    ])
    expect(lines[0]).not.toHaveProperty('counterpartyType')
    expect(lines[1]).not.toHaveProperty('counterpartyId')
  })
})

describe('line ids', () => {
  it('sends a saved row with its id and a new row without one', () => {
    const lines = linesFromDraftRows([
      row({ id: 'jel_1', glAccountId: 'acc_6300', debitMinor: 500 }),
      row({ glAccountId: 'acc_2000', creditMinor: 500 }),
    ])
    expect(lines[0]).toMatchObject({ id: 'jel_1' })
    expect(lines[1]).not.toHaveProperty('id')
  })

  it('carries the id through a load', () => {
    const rows = draftRowsFromLines([
      { id: 'jel_1', glAccountId: 'acc_6300', direction: 'debit', amountMinor: 500 },
    ])
    expect(rows[0]?.id).toBe('jel_1')
  })
})

describe('withSavedLineIds', () => {
  it('stamps the returned ids onto the savable rows it sent, in order', () => {
    const a = row({ glAccountId: 'acc_6300', debitMinor: 500 })
    const blank = row({ glAccountId: null })
    const b = row({ glAccountId: 'acc_2000', creditMinor: 500 })
    const sent = [a, blank, b]
    const saved = [
      { id: 'jel_a', glAccountId: 'acc_6300', direction: 'debit' as const, amountMinor: 500 },
      { id: 'jel_b', glAccountId: 'acc_2000', direction: 'credit' as const, amountMinor: 500 },
    ]
    const next = withSavedLineIds(sent, sent, saved)
    expect(next.map((r) => r.id)).toEqual(['jel_a', null, 'jel_b'])
  })

  // A saved row that is no longer savable was deleted server-side; its id must not come back.
  it('clears the id of a sent row the save dropped', () => {
    const cleared = row({ id: 'jel_old', glAccountId: 'acc_6300', debitMinor: null })
    const next = withSavedLineIds([cleared], [cleared], [])
    expect(next[0]?.id).toBeNull()
  })

  it('keeps rows added and edits made while the save was in flight', () => {
    const a = row({ glAccountId: 'acc_6300', debitMinor: 500 })
    const edited = { ...a, debitMinor: 700 }
    const added = row({ glAccountId: 'acc_1000', creditMinor: 700 })
    const next = withSavedLineIds(
      [edited, added],
      [a],
      [{ id: 'jel_a', glAccountId: 'acc_6300', direction: 'debit', amountMinor: 500 }]
    )
    expect(next[0]).toMatchObject({ id: 'jel_a', debitMinor: 700 })
    expect(next[1]).toBe(added)
  })
})

describe('draftRowsFromLines / linesFromDraftRows round-trip', () => {
  it('preserves account, direction, amount and memo', () => {
    const lines: JournalEntryLine[] = [
      { glAccountId: 'acc_6300', direction: 'debit', amountMinor: 2500, memo: 'office supplies' },
      { glAccountId: 'acc_1000', direction: 'credit', amountMinor: 2500 },
    ]
    const rows = draftRowsFromLines(lines)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ glAccountId: 'acc_6300', debitMinor: 2500, creditMinor: null })
    expect(rows[1]).toMatchObject({ glAccountId: 'acc_1000', creditMinor: 2500, debitMinor: null })
    expect(linesFromDraftRows(rows)).toEqual(lines)
  })

  it('preserves a counterparty, and reads its absence as null rather than undefined', () => {
    const lines: JournalEntryLine[] = [
      {
        glAccountId: 'acc_1100',
        direction: 'debit',
        amountMinor: 2500,
        counterpartyType: 'vendor',
        counterpartyId: 'company_1',
      },
      { glAccountId: 'acc_1000', direction: 'credit', amountMinor: 2500 },
    ]
    const rows = draftRowsFromLines(lines)
    expect(rows[0]).toMatchObject({ counterpartyType: 'vendor', counterpartyId: 'company_1' })
    expect(rows[1]).toMatchObject({ counterpartyType: null, counterpartyId: null })
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
      row({ glAccountId: 'acc_6300', debitMinor: 1000 }),
      row({ glAccountId: 'acc_6400', debitMinor: 500 }),
      row({ glAccountId: 'acc_1000', creditMinor: 1500 }),
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
      row({ glAccountId: 'acc_6300', debitMinor: 1000 }),
      row({ glAccountId: 'acc_1000', creditMinor: 400 }),
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
      row({ glAccountId: 'acc_6300', debitMinor: 1000 }),
      row({ glAccountId: 'acc_1000' }),
    ])
    expect(totals.balanced).toBe(false)
    expect(totals.differenceMinor).toBe(1000)
  })
})
