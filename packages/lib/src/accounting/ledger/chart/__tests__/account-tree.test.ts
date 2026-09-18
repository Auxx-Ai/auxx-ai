// packages/lib/src/accounting/ledger/chart/__tests__/account-tree.test.ts
//
// Pure, no doubles. `account()` fabricates rows with only the fields a test
// cares about; every function under test is total over `ChartAccountRow[]`.

import { describe, expect, it } from 'vitest'
import type { ChartAccountRow } from '../../types'
import {
  accountDepth,
  accountPath,
  accountPathLabel,
  buildAccountTree,
  descendantIds,
  sortChartTree,
} from '../account-tree'

function account(over: Partial<ChartAccountRow> & { id: string }): ChartAccountRow {
  return {
    code: null,
    name: over.id,
    accountType: 'asset',
    subtype: null,
    parentId: null,
    isActive: true,
    ...over,
  }
}

describe('buildAccountTree', () => {
  it('treats every row as a root when nothing has a parent', () => {
    const rows = [
      account({ id: 'b', code: '2000', name: 'Liabilities' }),
      account({ id: 'a', code: '1000', name: 'Assets' }),
    ]
    const tree = buildAccountTree(rows)
    expect(tree.map((n) => n.account.id)).toEqual(['a', 'b'])
    expect(tree.every((n) => n.depth === 0 && n.children.length === 0)).toBe(true)
  })

  it('nests a child under its parent, siblings ordered by code then name', () => {
    const rows = [
      account({ id: 'sales', code: '4000', name: 'Sales' }),
      account({ id: 'product', code: '4020', name: 'Product Income', parentId: 'sales' }),
      account({ id: 'service', code: '4010', name: 'Service Income', parentId: 'sales' }),
    ]
    const tree = buildAccountTree(rows)
    expect(tree).toHaveLength(1)
    const [sales] = tree
    expect(sales!.account.id).toBe('sales')
    expect(sales!.depth).toBe(0)
    expect(sales!.children.map((n) => n.account.id)).toEqual(['service', 'product'])
    expect(sales!.children.every((n) => n.depth === 1)).toBe(true)
  })

  it('treats an unknown parent id as a root', () => {
    const rows = [account({ id: 'a', parentId: 'does-not-exist' })]
    const tree = buildAccountTree(rows)
    expect(tree.map((n) => n.account.id)).toEqual(['a'])
    expect(tree[0]!.depth).toBe(0)
  })

  it('does not loop forever on a cycle, and drops no row', () => {
    const rows = [
      account({ id: 'a', parentId: 'b' }),
      account({ id: 'b', parentId: 'a' }),
      account({ id: 'c' }),
    ]
    const tree = buildAccountTree(rows)
    const ids = new Set<string>()
    const visit = (nodes: typeof tree) => {
      for (const node of nodes) {
        ids.add(node.account.id)
        visit(node.children)
      }
    }
    visit(tree)
    expect(ids).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('sortChartTree', () => {
  it('leaves a flat, already-ordered chart unchanged', () => {
    const rows = [
      account({ id: 'a', code: '1000' }),
      account({ id: 'b', code: '2000' }),
      account({ id: 'c', code: '3000' }),
    ]
    expect(sortChartTree(rows).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('is depth-first: a parent, then its whole subtree, before the next sibling', () => {
    const rows = [
      account({ id: 'assets', code: '1000' }),
      account({ id: 'bank', code: '1010', parentId: 'assets' }),
      account({ id: 'ar', code: '1020', parentId: 'assets' }),
      account({ id: 'liabilities', code: '2000' }),
    ]
    expect(sortChartTree(rows).map((a) => a.id)).toEqual(['assets', 'bank', 'ar', 'liabilities'])
  })

  it('returns every row exactly once even when the data cycles', () => {
    const rows = [account({ id: 'a', parentId: 'b' }), account({ id: 'b', parentId: 'a' })]
    expect(
      sortChartTree(rows)
        .map((a) => a.id)
        .sort()
    ).toEqual(['a', 'b'])
  })
})

describe('accountPath', () => {
  const rows = [
    account({ id: 'sales', code: '4000', name: 'Sales' }),
    account({ id: 'product', code: '4020', name: 'Product Income', parentId: 'sales' }),
  ]

  it('is root-first, the account itself last', () => {
    expect(accountPath(rows, 'product').map((a) => a.id)).toEqual(['sales', 'product'])
  })

  it('is just the account itself at the top level', () => {
    expect(accountPath(rows, 'sales').map((a) => a.id)).toEqual(['sales'])
  })

  it('is empty for an id not in the chart', () => {
    expect(accountPath(rows, 'nope')).toEqual([])
  })

  it('stops rather than loops forever on a cycle', () => {
    const cyclic = [account({ id: 'a', parentId: 'b' }), account({ id: 'b', parentId: 'a' })]
    expect(accountPath(cyclic, 'a').map((a) => a.id)).toEqual(['b', 'a'])
  })
})

describe('accountPathLabel', () => {
  it('joins bare ancestor names with the leaf accountLabel (D8)', () => {
    const rows = [
      account({ id: 'sales', code: '4000', name: 'Sales' }),
      account({ id: 'product', code: '4020', name: 'Product Income', parentId: 'sales' }),
    ]
    expect(accountPathLabel(rows, 'product')).toBe('Sales: 4020 Product Income')
  })

  it('is just the leaf label at the top level', () => {
    const rows = [account({ id: 'sales', code: '4000', name: 'Sales' })]
    expect(accountPathLabel(rows, 'sales')).toBe('4000 Sales')
  })

  it('is empty for an id not in the chart', () => {
    expect(accountPathLabel([], 'nope')).toBe('')
  })
})

describe('descendantIds', () => {
  it('collects every level under an account, not itself', () => {
    const rows = [
      account({ id: 'sales' }),
      account({ id: 'product', parentId: 'sales' }),
      account({ id: 'physical', parentId: 'product' }),
      account({ id: 'other' }),
    ]
    expect(descendantIds(rows, 'sales')).toEqual(new Set(['product', 'physical']))
  })

  it('is empty for a leaf account', () => {
    const rows = [account({ id: 'sales' }), account({ id: 'product', parentId: 'sales' })]
    expect(descendantIds(rows, 'product')).toEqual(new Set())
  })

  it('does not loop forever on a cycle', () => {
    const rows = [account({ id: 'a', parentId: 'b' }), account({ id: 'b', parentId: 'a' })]
    expect(descendantIds(rows, 'a')).toEqual(new Set(['b']))
  })
})

describe('accountDepth', () => {
  it('is 0 at the top level', () => {
    expect(accountDepth([account({ id: 'sales' })], 'sales')).toBe(0)
  })

  it('counts hops to the root', () => {
    const rows = [
      account({ id: 'sales' }),
      account({ id: 'product', parentId: 'sales' }),
      account({ id: 'physical', parentId: 'product' }),
    ]
    expect(accountDepth(rows, 'physical')).toBe(2)
  })

  it('is 0 for an id not in the chart', () => {
    expect(accountDepth([], 'nope')).toBe(0)
  })
})
