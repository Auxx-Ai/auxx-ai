// apps/web/src/components/accounting/ui/reports/__tests__/report-helpers.test.ts

import type { StatementRow as LibStatementRow } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import {
  compareAsOfFor,
  compareRangeFor,
  periodEndDate,
  periodKeyFromDate,
  periodStartDate,
  priorPeriodKey,
  priorYearPeriodKey,
  profitAndLossColumns,
  shiftPeriodKey,
  toStatementTableRows,
} from '../report-helpers'

describe('periodStartDate / periodEndDate', () => {
  it('returns the first and last calendar day of an ordinary month', () => {
    expect(periodStartDate('2027-03')).toBe('2027-03-01')
    expect(periodEndDate('2027-03')).toBe('2027-03-31')
  })

  it('handles a 30-day month', () => {
    expect(periodEndDate('2027-04')).toBe('2027-04-30')
  })

  it('handles February in a leap year and a non-leap year', () => {
    expect(periodEndDate('2028-02')).toBe('2028-02-29')
    expect(periodEndDate('2027-02')).toBe('2027-02-28')
  })

  it('passes a malformed key through unchanged', () => {
    expect(periodStartDate('not-a-key')).toBe('not-a-key')
    expect(periodEndDate('')).toBe('')
  })
})

describe('periodKeyFromDate', () => {
  it('is the inverse of periodEndDate/periodStartDate', () => {
    expect(periodKeyFromDate(periodEndDate('2026-08'))).toBe('2026-08')
    expect(periodKeyFromDate(periodStartDate('2026-08'))).toBe('2026-08')
  })
})

describe('shiftPeriodKey', () => {
  it('moves within a year', () => {
    expect(shiftPeriodKey('2027-03', -1)).toBe('2027-02')
    expect(shiftPeriodKey('2027-03', 1)).toBe('2027-04')
  })

  it('crosses a year boundary backward and forward', () => {
    expect(shiftPeriodKey('2027-01', -1)).toBe('2026-12')
    expect(shiftPeriodKey('2027-12', 1)).toBe('2028-01')
  })

  it('shifts a full year', () => {
    expect(shiftPeriodKey('2027-03', -12)).toBe('2026-03')
  })

  it('priorPeriodKey and priorYearPeriodKey are the -1 and -12 shortcuts', () => {
    expect(priorPeriodKey('2027-01')).toBe('2026-12')
    expect(priorYearPeriodKey('2027-03')).toBe('2026-03')
  })
})

describe('compareAsOfFor', () => {
  it('is undefined for "none"', () => {
    expect(compareAsOfFor('2027-03-31', 'none')).toBeUndefined()
  })

  it('derives the prior period end from an as-of date', () => {
    expect(compareAsOfFor('2027-03-31', 'prior_period')).toBe('2027-02-28')
  })

  it('derives the prior year end, leap year included', () => {
    expect(compareAsOfFor('2028-02-29', 'prior_year')).toBe('2027-02-28')
  })
})

describe('compareRangeFor', () => {
  it('is undefined for "none"', () => {
    expect(compareRangeFor('2026-08-01', '2026-08-31', 'none')).toBeUndefined()
  })

  it('shifts a one-month range back by one month', () => {
    expect(compareRangeFor('2026-08-01', '2026-08-31', 'prior_period')).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('shifts a multi-month range back by its own SPAN, not by one month', () => {
    // A quarter (Jun-Aug) compares to the prior quarter (Mar-May), not to
    // Jul-Aug shifted by one month.
    expect(compareRangeFor('2026-06-01', '2026-08-31', 'prior_period')).toEqual({
      from: '2026-03-01',
      to: '2026-05-31',
    })
  })

  it('shifts a range back exactly one year regardless of span', () => {
    expect(compareRangeFor('2026-08-01', '2026-08-31', 'prior_year')).toEqual({
      from: '2025-08-01',
      to: '2025-08-31',
    })
  })
})

describe('profitAndLossColumns', () => {
  it('is one column with no compare', () => {
    const columns = profitAndLossColumns({ from: '2026-08-01', to: '2026-08-31' }, 'UTC')
    expect(columns).toHaveLength(1)
    expect(columns[0]).toMatchObject({ key: 'primary', align: 'right', signed: true })
  })

  it('is two columns with a compare range', () => {
    const columns = profitAndLossColumns(
      {
        from: '2026-08-01',
        to: '2026-08-31',
        compare: { from: '2025-08-01', to: '2025-08-31' },
      },
      'UTC'
    )
    expect(columns).toHaveLength(2)
    expect(columns.map((c) => c.key)).toEqual(['primary', 'compare'])
  })
})

describe('toStatementTableRows', () => {
  function libRow(
    overrides: Partial<LibStatementRow> & Pick<LibStatementRow, 'id'>
  ): LibStatementRow {
    return {
      label: overrides.id,
      depth: 0,
      kind: 'line',
      values: [1000, null],
      ...overrides,
    }
  }

  it('carries accountCode, badge, note and recordId through', () => {
    // `recordId` rides through since the aging pages (HANDOFF slot 2H): a child
    // row's click opens the document behind it.
    const rows = toStatementTableRows([
      libRow({
        id: '4000',
        meta: {
          accountCode: '4000',
          badge: 'Not in chart',
          note: 'a note',
          recordId: 'def_invoice:inst_1',
        },
      }),
      libRow({ id: 'x', meta: { recordId: 'not-a-record-id' } }),
    ])
    expect(rows[0]?.meta).toMatchObject({
      accountCode: '4000',
      badge: 'Not in chart',
      note: 'a note',
    })
    expect(rows[0]?.meta?.recordId).toBe('def_invoice:inst_1')
    // A malformed id is dropped rather than handed to the drawer.
    expect(rows[1]?.meta?.recordId).toBeUndefined()
  })

  it('is undefined meta when the source row has none', () => {
    const rows = toStatementTableRows([libRow({ id: 'total' })])
    expect(rows[0]?.meta).toBeUndefined()
  })

  it('recurses into children', () => {
    const rows = toStatementTableRows([
      libRow({
        id: 'assets',
        kind: 'section',
        children: [libRow({ id: '1000', meta: { accountCode: '1000' } })],
      }),
    ])
    expect(rows[0]?.children).toHaveLength(1)
    expect(rows[0]?.children?.[0]?.meta).toEqual({
      accountCode: '1000',
      badge: undefined,
      note: undefined,
    })
  })
})
