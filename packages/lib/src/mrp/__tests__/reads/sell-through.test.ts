// packages/lib/src/mrp/__tests__/reads/sell-through.test.ts

import { describe, expect, it } from 'vitest'
import type { SubpartRow } from '../../../inventory/costing/cost-calculator'
import { walkBom } from '../../reads/part-item'
import { computeBuildableCeiling, pickLimitingNode } from '../../reads/sell-through'

const edge = (parentPartId: string, childPartId: string, quantity = 1): SubpartRow => ({
  parentPartId,
  childPartId,
  quantity,
})

const TREE = walkBom('lift', [
  edge('lift', 'motorAsm'),
  edge('lift', 'frame', 2),
  edge('motorAsm', 'motor'),
  edge('motorAsm', 'bracket', 4),
])

describe('pickLimitingNode', () => {
  it('picks the descendant with the earliest stockout, at any depth', () => {
    const items = new Map([
      ['motorAsm', { stockoutDate: '2026-11-03' }],
      ['motor', { stockoutDate: '2026-10-20' }],
      ['frame', { stockoutDate: null }],
    ])
    expect(pickLimitingNode(TREE, items)?.partId).toBe('motor')
  })

  it('is null when nothing stocks out', () => {
    expect(pickLimitingNode(TREE, new Map([['frame', { stockoutDate: null }]]))).toBeNull()
  })
})

describe('computeBuildableCeiling', () => {
  it('takes the least floor(on hand / quantity per) over direct children only', () => {
    const items = new Map([
      ['motorAsm', { onHand: 6 }],
      ['frame', { onHand: 9 }],
      ['motor', { onHand: 0 }],
    ])
    const ceiling = computeBuildableCeiling(TREE, items)
    expect(ceiling?.quantity).toBe(4)
    expect(ceiling?.node.partId).toBe('frame')
  })

  it('treats negative on hand as zero', () => {
    const ceiling = computeBuildableCeiling(TREE, new Map([['motorAsm', { onHand: -3 }]]))
    expect(ceiling?.quantity).toBe(0)
  })
})
