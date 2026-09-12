// apps/web/src/components/returns/hooks/use-salvage-tree.test.ts

// The two pure helpers behind §6.6's invariants. Both are what the CARD reads
// to decide whether to offer an affordance, so a wrong answer here is a wrong
// affordance, not a wrong number — which is why they are tested apart from the
// React they are used in.

import type { SalvageNode } from '@auxx/lib/returns/client'
import { describe, expect, it } from 'vitest'
import { canSplitNode, decidedDescendantCount, MIN_SPLITTABLE_QUANTITY } from './use-salvage-tree'

function node(partial: Partial<SalvageNode> & Pick<SalvageNode, 'key'>): SalvageNode {
  return {
    partId: `part-${partial.key}`,
    partName: `Part ${partial.key}`,
    partNumber: null,
    depth: 0,
    quantity: 1,
    status: 'undecided',
    salvagePercent: 100,
    hasChildren: false,
    materialized: false,
    children: null,
    ...partial,
  }
}

describe('canSplitNode', () => {
  it('refuses a row with nothing to divide', () => {
    expect(canSplitNode(node({ key: 'a', quantity: 0 }))).toBe(false)
    expect(canSplitNode(node({ key: 'a', quantity: 1 }))).toBe(false)
  })

  it('allows a row carrying at least two units', () => {
    expect(canSplitNode(node({ key: 'a', quantity: MIN_SPLITTABLE_QUANTITY }))).toBe(true)
    expect(canSplitNode(node({ key: 'a', quantity: 4 }))).toBe(true)
  })
})

describe('decidedDescendantCount', () => {
  it('is zero for an unexpanded branch, because nothing is in memory to count', () => {
    expect(decidedDescendantCount(node({ key: 'root', hasChildren: true, children: null }))).toBe(0)
  })

  it('ignores a node with no row — undecided by absence', () => {
    const root = node({
      key: 'root',
      hasChildren: true,
      children: [node({ key: 'a', materialized: false, status: 'undecided' })],
    })
    expect(decidedDescendantCount(root)).toBe(0)
  })

  it('ignores a materialized row that is still undecided', () => {
    const root = node({
      key: 'root',
      hasChildren: true,
      children: [node({ key: 'a', materialized: true, status: 'undecided' })],
    })
    expect(decidedDescendantCount(root)).toBe(0)
  })

  it('counts decided rows at every depth, and never the node itself', () => {
    const root = node({
      key: 'root',
      materialized: true,
      status: 'damaged',
      hasChildren: true,
      children: [
        node({
          key: 'a',
          materialized: true,
          status: 'good',
          hasChildren: true,
          children: [
            node({ key: 'a1', materialized: true, status: 'scrap' }),
            node({ key: 'a2', materialized: true, status: 'undecided' }),
          ],
        }),
        node({ key: 'b', materialized: true, status: 'missing' }),
      ],
    })
    expect(decidedDescendantCount(root)).toBe(3)
  })
})
