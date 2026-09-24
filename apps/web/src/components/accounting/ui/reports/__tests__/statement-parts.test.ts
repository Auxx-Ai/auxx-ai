// apps/web/src/components/accounting/ui/reports/__tests__/statement-parts.test.ts

import { describe, expect, it } from 'vitest'
import {
  allParentIds,
  filterStatementRows,
  hasAnyDrillKey,
  maxAccountCodeLength,
  type StatementRow,
  verdictRowId,
  verdictText,
} from '../statement-parts'

function row(overrides: Partial<StatementRow> & Pick<StatementRow, 'id'>): StatementRow {
  return {
    label: overrides.id,
    depth: 0,
    kind: 'line',
    values: [],
    ...overrides,
  }
}

describe('allParentIds', () => {
  it('names every row that owns children and nothing else', () => {
    const rows = [
      row({ id: 'assets', kind: 'section', children: [row({ id: 'a1' })] }),
      row({ id: 'empty-section', kind: 'section', children: [] }),
      row({ id: 'total', kind: 'total' }),
    ]
    expect([...allParentIds(rows)]).toEqual(['assets'])
  })
})

describe('hasAnyDrillKey', () => {
  // 🛑 The gate this replaced was `kind !== 'section'`, which every one of
  // these rows passes while carrying nothing to drill on - so five reports
  // painted a pointer cursor on rows that did nothing when clicked.
  it('refuses a total, a subtotal and a computed row that carry no key', () => {
    expect(hasAnyDrillKey(row({ id: 'total', kind: 'total' }))).toBe(false)
    expect(hasAnyDrillKey(row({ id: 'sub', kind: 'subtotal' }))).toBe(false)
    expect(hasAnyDrillKey(row({ id: 'gross-profit', kind: 'computed' }))).toBe(false)
  })

  it('refuses the general ledger`s INCOMPLETE banner row', () => {
    expect(hasAnyDrillKey(row({ id: 'incomplete', kind: 'computed', meta: {} }))).toBe(false)
  })

  it('accepts any of the three keys a statement row can be drilled on', () => {
    expect(hasAnyDrillKey(row({ id: 'a', meta: { glAccountId: 'acc_1' } }))).toBe(true)
    expect(hasAnyDrillKey(row({ id: 'b', meta: { glPostingId: 'pos_1' } }))).toBe(true)
    expect(hasAnyDrillKey(row({ id: 'c', meta: { recordId: 'def:inst' } }))).toBe(true)
  })

  // A contact group on the aging report, and a box section on the 1099: both
  // have children and no key, so the row body falls through to expand rather
  // than being swallowed by a handler that returns undefined.
  it('refuses a group row that has children but no key of its own', () => {
    expect(hasAnyDrillKey(row({ id: 'contact', children: [row({ id: 'doc' })] }))).toBe(false)
  })
})

describe('verdictRowId', () => {
  it('picks the LAST top-level total row - a statement ends on its bottom line', () => {
    const rows = [
      row({ id: 'assets', kind: 'section', children: [row({ id: 'a1', kind: 'total' })] }),
      row({ id: 'total-liabilities', kind: 'total' }),
      row({ id: 'total-liabilities-equity', kind: 'total' }),
    ]
    expect(verdictRowId(rows)).toBe('total-liabilities-equity')
  })

  it('ignores a total nested inside a section', () => {
    const rows = [
      row({ id: 'assets', kind: 'section', children: [row({ id: 'a1', kind: 'total' })] }),
    ]
    expect(verdictRowId(rows)).toBeUndefined()
  })

  it('is undefined for a flat list of lines, so the caller can fall back to the strip', () => {
    expect(verdictRowId([row({ id: 'cash' }), row({ id: 'ar' })])).toBeUndefined()
    expect(verdictRowId([])).toBeUndefined()
  })
})

describe('verdictText', () => {
  it('joins the label and its follow-up, and omits the space when there is none', () => {
    expect(verdictText({ ok: true, label: 'Balanced.', detail: 'Debits equal credits.' })).toBe(
      'Balanced. Debits equal credits.'
    )
    expect(verdictText({ ok: false, label: 'Out of balance by $5.00.' })).toBe(
      'Out of balance by $5.00.'
    )
  })
})

describe('filterStatementRows', () => {
  const cash = row({
    id: 'cash',
    kind: 'line',
    meta: { accountCode: '1010', accountName: 'Cash' },
  })
  const ar = row({
    id: 'ar',
    kind: 'line',
    meta: { accountCode: '1200', accountName: 'Accounts Receivable' },
  })
  const inventory = row({
    id: 'inventory',
    // A locked opening-grid account: `computed`, but it names an account.
    kind: 'computed',
    meta: { accountCode: '1310', accountName: 'Raw Materials' },
  })
  const subtotal = row({ id: 'assets:subtotal', kind: 'subtotal', values: [100, 0] })
  const section = row({
    id: 'assets',
    kind: 'section',
    values: [100, 0],
    children: [cash, ar, inventory, subtotal],
  })
  const grandTotal = row({ id: 'total', kind: 'total', values: [100, 0] })

  it('returns the statement untouched when the query is blank', () => {
    const out = filterStatementRows([section, grandTotal], '  ')
    expect(out.rows).toEqual([section, grandTotal])
    expect(out.matchCount).toBe(3)
    expect(out.totalCount).toBe(3)
  })

  it('matches an account by name or by code', () => {
    expect(filterStatementRows([section], 'receiv').rows[0]?.children).toEqual([ar])
    expect(filterStatementRows([section], '1010').rows[0]?.children).toEqual([cash])
  })

  it('keeps a locked `computed` account but drops a derived `computed` figure', () => {
    const netIncome = row({ id: 'net-income', kind: 'computed', label: 'Raw net income' })
    const out = filterStatementRows([section, netIncome], 'raw')
    expect(out.rows.map((r) => r.id)).toEqual(['assets'])
    expect(out.rows[0]?.children).toEqual([inventory])
  })

  it('drops the subtotal, the grand total and every section with no match', () => {
    const liabilities = row({
      id: 'liabilities',
      kind: 'section',
      children: [row({ id: 'ap', kind: 'line', meta: { accountCode: '2000', accountName: 'AP' } })],
    })
    const out = filterStatementRows([section, liabilities, grandTotal], 'cash')
    expect(out.rows.map((r) => r.id)).toEqual(['assets'])
    expect(out.rows[0]?.children?.map((r) => r.id)).toEqual(['cash'])
    expect(out.matchCount).toBe(1)
    expect(out.totalCount).toBe(4)
  })

  it('does not mutate the rows it filters', () => {
    filterStatementRows([section], 'cash')
    expect(section.children).toHaveLength(4)
  })
})

describe('maxAccountCodeLength', () => {
  it('is 0 when no row carries a code', () => {
    expect(
      maxAccountCodeLength([
        row({ id: 'a', meta: { accountName: 'Checking' } }),
        row({ id: 'b', kind: 'total' }),
      ])
    ).toBe(0)
  })

  it('measures the longest code, children included', () => {
    const rows = [
      row({
        id: 'assets',
        kind: 'section',
        children: [
          row({ id: 'a', meta: { accountCode: '100', accountName: 'Cash' } }),
          row({ id: 'b', meta: { accountCode: '10500', accountName: 'Savings' } }),
          // No code at all: this is the account the track exists for.
          row({ id: 'c', meta: { accountName: 'Truck' } }),
        ],
      }),
    ]
    expect(maxAccountCodeLength(rows)).toBe(5)
  })

  it('ignores a code that is only whitespace', () => {
    expect(
      maxAccountCodeLength([row({ id: 'a', meta: { accountCode: '   ', accountName: 'Cash' } })])
    ).toBe(0)
  })
})
