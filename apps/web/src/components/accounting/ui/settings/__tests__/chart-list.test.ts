// apps/web/src/components/accounting/ui/settings/__tests__/chart-list.test.ts

import type { ChartAccountRow } from '@auxx/lib/accounting/ledger/client'
import { describe, expect, it } from 'vitest'
import { chartGroupTree, flattenAccountIds } from '../chart-list'

function account(overrides: Partial<ChartAccountRow>): ChartAccountRow {
  return {
    id: overrides.id ?? overrides.code ?? 'acc',
    code: '1000',
    name: 'Account',
    accountType: 'revenue',
    subtype: null,
    parentId: null,
    isActive: true,
    ...overrides,
  }
}

describe('chartGroupTree', () => {
  const nested: ChartAccountRow[] = [
    account({ id: 'sales', code: '4000', name: 'Sales' }),
    account({ id: 'service', code: '4010', name: 'Service Income', parentId: 'sales' }),
    account({ id: 'product', code: '4020', name: 'Product Income', parentId: 'sales' }),
    account({ id: 'physical', code: '4021', name: 'Physical Goods', parentId: 'product' }),
    account({ id: 'other', code: '4900', name: 'Other Revenue' }),
  ]

  it('with no search, renders every account in D9 tree order', () => {
    const tree = chartGroupTree(nested, null)
    const flat: Array<[string, number]> = []
    const visit = (nodes: typeof tree) => {
      for (const node of nodes) {
        flat.push([node.account.id, node.depth])
        visit(node.children)
      }
    }
    visit(tree)
    expect(flat).toEqual([
      ['sales', 0],
      ['service', 1],
      ['product', 1],
      ['physical', 2],
      ['other', 0],
    ])
  })

  it('a search matching only a leaf keeps its ancestors, so the indent still reads', () => {
    const tree = chartGroupTree(nested, new Set(['physical']))
    // `sales` (root) -> `product` (its child, kept only as scaffolding) -> `physical` (the match).
    expect(tree.map((n) => n.account.id)).toEqual(['sales'])
    expect(tree[0]?.children.map((n) => n.account.id)).toEqual(['product'])
    expect(tree[0]?.children[0]?.children.map((n) => n.account.id)).toEqual(['physical'])
  })

  it('a search matching a parent does not pull in siblings that did not match', () => {
    const tree = chartGroupTree(nested, new Set(['service']))
    expect(tree.map((n) => n.account.id)).toEqual(['sales'])
    expect(tree[0]?.children.map((n) => n.account.id)).toEqual(['service'])
  })

  it('a search matching a top-level account with no ancestors renders it alone', () => {
    const tree = chartGroupTree(nested, new Set(['other']))
    expect(tree.map((n) => n.account.id)).toEqual(['other'])
  })
})

describe('flattenAccountIds', () => {
  const nested: ChartAccountRow[] = [
    account({ id: 'sales', code: '4000', name: 'Sales' }),
    account({ id: 'service', code: '4010', name: 'Service Income', parentId: 'sales' }),
    account({ id: 'product', code: '4020', name: 'Product Income', parentId: 'sales' }),
    account({ id: 'physical', code: '4021', name: 'Physical Goods', parentId: 'product' }),
    account({ id: 'other', code: '4900', name: 'Other Revenue' }),
  ]

  it('with no search, flattens every rendered row depth-first', () => {
    const tree = chartGroupTree(nested, null)
    expect(flattenAccountIds(tree)).toEqual(['sales', 'service', 'product', 'physical', 'other'])
  })

  it('with a search that matches only a child, the visible id list includes the parent', () => {
    // Selection reads this list, not the search-filtered accounts alone - a
    // search hit's ancestor renders with the same checkbox and must stay
    // reachable by Cmd+A and shift-range.
    const tree = chartGroupTree(nested, new Set(['physical']))
    const ids = flattenAccountIds(tree)
    expect(ids).toContain('physical')
    expect(ids).toContain('product')
    expect(ids).toContain('sales')
    expect(ids).not.toContain('service')
    expect(ids).not.toContain('other')
  })
})
