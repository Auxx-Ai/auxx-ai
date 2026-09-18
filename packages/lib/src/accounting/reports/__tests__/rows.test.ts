// packages/lib/src/accounting/reports/__tests__/rows.test.ts

import { describe, expect, it } from 'vitest'
import { computedRow, type StatementRow, statementSection, toCsvRows, totalRow } from '../rows'

describe('statementSection', () => {
  it('sums its lines into the section total, and into a labelled total row', () => {
    const section = statementSection(
      'assets',
      'Assets',
      [
        { id: '1000', label: '1000 Cash', values: [100_000] },
        { id: '1100', label: '1100 Accounts Receivable', values: [50_000] },
      ],
      { totalLabel: 'Total assets' }
    )

    expect(section.kind).toBe('section')
    expect(section.values).toEqual([150_000])
    expect(section.children).toHaveLength(3)
    expect(section.children?.[2]).toMatchObject({
      label: 'Total assets',
      kind: 'subtotal',
      values: [150_000],
    })
  })

  it('a null value in a line does not poison the section total', () => {
    const section = statementSection('x', 'X', [
      { id: 'a', label: 'A', values: [100, null] },
      { id: 'b', label: 'B', values: [null, 50] },
    ])
    expect(section.values).toEqual([100, 50])
  })
})

describe('computedRow / totalRow', () => {
  it('mark themselves with the right kind', () => {
    expect(computedRow('gp', 'Gross profit', [100]).kind).toBe('computed')
    expect(totalRow('ni', 'Net income', [100]).kind).toBe('total')
  })
})

describe('toCsvRows', () => {
  it('renders minor units as plain major-unit decimals, and indents by depth', () => {
    const rows = [
      statementSection(
        'assets',
        'Assets',
        [{ id: '1000', label: '1000 Cash', values: [123_456] }],
        {
          totalLabel: 'Total assets',
        }
      ),
    ]
    const csv = toCsvRows(rows, [{ key: 'value', label: 'Value' }])

    expect(csv).toContain('Label,Value')
    expect(csv).toContain('Assets,1234.56')
    expect(csv).toContain('  1000 Cash,1234.56')
    expect(csv).toContain('  Total assets,1234.56')
  })

  it('renders a null value as an empty cell', () => {
    const rows = [totalRow('t', 'Total', [null])]
    const csv = toCsvRows(rows, [{ key: 'value', label: 'Value' }])
    expect(csv).toContain('Total,')
  })

  it('indents a nested sub-account two levels under its section (CHART-HIERARCHY.md §5)', () => {
    const rows: StatementRow[] = [
      {
        id: 'revenue',
        label: 'Revenue',
        depth: 0,
        kind: 'section',
        values: [400_00],
        children: [
          {
            id: 'sales',
            label: '4000 Sales',
            depth: 1,
            kind: 'line',
            values: [100_00],
            children: [
              {
                id: 'product',
                label: '4010 Product Income',
                depth: 2,
                kind: 'line',
                values: [250_00],
              },
              {
                id: 'sales:total',
                label: 'Total Sales',
                depth: 2,
                kind: 'subtotal',
                values: [350_00],
              },
            ],
          },
        ],
      },
    ]
    const csv = toCsvRows(rows, [{ key: 'value', label: 'Value' }])

    expect(csv).toContain('Revenue,400.00')
    expect(csv).toContain('  4000 Sales,100.00')
    expect(csv).toContain('    4010 Product Income,250.00')
    expect(csv).toContain('    Total Sales,350.00')
  })
})
