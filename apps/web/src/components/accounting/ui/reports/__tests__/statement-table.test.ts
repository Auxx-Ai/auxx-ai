// apps/web/src/components/accounting/ui/reports/__tests__/statement-table.test.ts

import { describe, expect, it } from 'vitest'
import { flattenVisibleRows, type StatementRow } from '../statement-table'

function row(overrides: Partial<StatementRow> & Pick<StatementRow, 'id'>): StatementRow {
  return {
    label: overrides.id,
    depth: 0,
    kind: 'line',
    values: [],
    ...overrides,
  }
}

describe('flattenVisibleRows', () => {
  it('returns top-level rows unchanged when nothing has children', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })]
    expect(flattenVisibleRows(rows, new Set())).toEqual([
      { row: rows[0], isChild: false },
      { row: rows[1], isChild: false },
    ])
  })

  it('keeps a row with children collapsed by default', () => {
    const child = row({ id: 'child-1' })
    const rows = [row({ id: 'parent', children: [child] })]
    const flat = flattenVisibleRows(rows, new Set())
    expect(flat).toHaveLength(1)
    expect(flat[0]?.row.id).toBe('parent')
  })

  it('inserts children immediately after their parent once expanded', () => {
    const childA = row({ id: 'child-a' })
    const childB = row({ id: 'child-b' })
    const rows = [
      row({ id: 'before' }),
      row({ id: 'parent', children: [childA, childB] }),
      row({ id: 'after' }),
    ]

    const flat = flattenVisibleRows(rows, new Set(['parent']))

    expect(flat.map((f) => f.row.id)).toEqual(['before', 'parent', 'child-a', 'child-b', 'after'])
    expect(flat.map((f) => f.isChild)).toEqual([false, false, true, true, false])
  })

  it('does not expand a row not named in expandedIds, even if others are', () => {
    const rows = [
      row({ id: 'p1', children: [row({ id: 'c1' })] }),
      row({ id: 'p2', children: [row({ id: 'c2' })] }),
    ]
    const flat = flattenVisibleRows(rows, new Set(['p2']))
    expect(flat.map((f) => f.row.id)).toEqual(['p1', 'p2', 'c2'])
  })

  it('ignores an empty children array as if there were none', () => {
    const rows = [row({ id: 'a', children: [] })]
    const flat = flattenVisibleRows(rows, new Set(['a']))
    expect(flat).toEqual([{ row: rows[0], isChild: false }])
  })
})
