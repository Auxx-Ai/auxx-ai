// packages/lib/src/mrp/__tests__/reads/bom-where-used.test.ts

import { describe, expect, it } from 'vitest'
import type { SubpartRow } from '../../../inventory/costing/cost-calculator'
import { walkBom } from '../../reads/part-item'
import { overlayFromItem } from '../../reads/part-series'
import { shapeParents, topLevelAncestors } from '../../reads/where-used'
import { item } from '../support/plan-item'

const edge = (parentPartId: string, childPartId: string, quantity = 1): SubpartRow => ({
  parentPartId,
  childPartId,
  quantity,
})

/** 07 §4.6: Lift A and Lift B both use the motor assembly, which uses the motor. */
const EDGES = [
  edge('liftA', 'motorAsm'),
  edge('liftA', 'frame', 2),
  edge('liftB', 'motorAsm'),
  edge('motorAsm', 'motor'),
  edge('motorAsm', 'bracket', 4),
]

describe('walkBom', () => {
  it('lays out the subtree depth-first with path keys and shared counts', () => {
    const nodes = walkBom('liftA', EDGES)
    expect(nodes.map((n) => [n.key, n.depth, n.parentKey])).toEqual([
      ['liftA/motorAsm', 1, null],
      ['liftA/motorAsm/motor', 2, 'liftA/motorAsm'],
      ['liftA/motorAsm/bracket', 2, 'liftA/motorAsm'],
      ['liftA/frame', 1, null],
    ])
    expect(nodes[0]).toMatchObject({ hasChildren: true, parentCount: 2, quantityPer: 1 })
    expect(nodes[2]).toMatchObject({ hasChildren: false, parentCount: 1, quantityPer: 4 })
  })

  it('stops at a cycle instead of looping', () => {
    const nodes = walkBom('a', [edge('a', 'b'), edge('b', 'a')])
    expect(nodes.map((n) => n.partId)).toEqual(['b'])
  })

  it('a leaf has no subtree', () => {
    expect(walkBom('motor', EDGES)).toEqual([])
  })
})

describe('where used', () => {
  it('finds every top-level product above a shared part', () => {
    expect(topLevelAncestors('motor', EDGES)).toEqual(['liftA', 'liftB'])
    expect(topLevelAncestors('liftA', EDGES)).toEqual([])
  })

  it('splits consumption by parent and keeps the remainder as direct sales', () => {
    const rows = shapeParents({
      partId: 'motorAsm',
      edges: EDGES,
      shares: [
        { componentId: 'motorAsm', producedPartId: 'liftA', quantity: 55, share: 0.6875 },
        { componentId: 'motorAsm', producedPartId: 'liftB', quantity: 25, share: 0.3125 },
        { componentId: 'motorAsm', producedPartId: 'oldLift', quantity: 10, share: 0 },
      ],
      totalConsumed: 100,
    })
    expect(rows.map((r) => [r.partId, r.share, r.inBom, r.isDirectSale])).toEqual([
      ['liftA', 0.55, true, false],
      ['liftB', 0.25, true, false],
      ['motorAsm', 0.1, false, true],
      ['oldLift', 0.1, false, false],
    ])
  })

  it('lists BOM parents with no history at a zero share', () => {
    const rows = shapeParents({ partId: 'motor', edges: EDGES, shares: [], totalConsumed: 0 })
    expect(rows).toEqual([
      {
        partId: 'motorAsm',
        quantityPer: 1,
        inBom: true,
        isDirectSale: false,
        consumed: 0,
        share: 0,
      },
    ])
  })
})

describe('overlayFromItem', () => {
  it('overlays zones for a buffered item and marks its stored dates in order', () => {
    const overlay = overlayFromItem(
      item({
        partId: 'p1',
        buffered: true,
        topOfRed: 45,
        topOfYellow: 165,
        topOfGreen: 225,
        orderByDate: '2026-10-11',
        stockoutDate: '2026-12-31',
        nextArrivalDate: '2026-12-10',
      })
    )
    expect(overlay.zones).toEqual({ topOfRed: 45, topOfYellow: 165, topOfGreen: 225 })
    expect(overlay.events.map((e) => e.kind)).toEqual(['order_by', 'next_arrival', 'stockout'])
  })

  it('has no zones for an unbuffered item and nothing without one', () => {
    expect(
      overlayFromItem(item({ partId: 'p1', topOfRed: 1, topOfYellow: 2, topOfGreen: 3 })).zones
    ).toBeNull()
    expect(overlayFromItem(undefined)).toEqual({ zones: null, events: [], projectionBasis: null })
  })
})
