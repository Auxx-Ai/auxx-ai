// packages/lib/src/mrp/__tests__/reads/summary-list.test.ts

import { describe, expect, it } from 'vitest'
import { buildParentGraph } from '../../../inventory/costing/cost-calculator'
import { finishedGoodsAbove, isSoldFinishedGood, likePattern, toListItem } from '../../reads/list'
import { lateDays } from '../../reads/part-item'
import { orderByHorizons, shapeSummary, shapeSupplierFacet } from '../../reads/summary'
import { item } from '../support/plan-item'

describe('orderByHorizons', () => {
  it('counts 7 and 30 days from the run day, across a month end', () => {
    expect(orderByHorizons('2026-09-28')).toEqual({ week: '2026-10-05', month: '2026-10-28' })
  })
})

describe('shapeSummary', () => {
  it('folds the prefixed counts and derives unbuffered', () => {
    const counts = shapeSummary({
      total: 10,
      overdue: 2,
      thisWeek: 3,
      within30Days: 5,
      later: 4,
      flagged: 1,
      fine: 3,
      buffered: 6,
      'kind:purchase': 7,
      'kind:build': 2,
      'supply:bought': 8,
      'supply:made': 2,
      'mode:scheduled': 4,
      'flag:no_lead_time': 1,
    })
    expect(counts.unbuffered).toBe(4)
    expect(counts.bySuggestionKind).toEqual({ build: 2, purchase: 7 })
    expect(counts.bySupplyType).toEqual({ bought: 8, made: 2, unclassified: 0 })
    expect(counts.byOrderMode).toEqual({ when_needed: 0, scheduled: 4 })
    expect(counts.byFlag.no_lead_time).toBe(1)
    expect(counts.byFlag.mirror_drift).toBe(0)
  })

  it('reads an empty run as zeros', () => {
    const counts = shapeSummary({})
    expect(counts.total).toBe(0)
    expect(counts.unbuffered).toBe(0)
  })
})

describe('list shaping', () => {
  it('escapes LIKE metacharacters in the search term', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%')
  })

  it('derives days of cover from the stored stockout date and the run day', () => {
    const row = toListItem(
      {
        item: item({ partId: 'p1', stockoutDate: '2026-10-04' }),
        partName: 'Motor',
        partSku: 'M-1',
        stockStatus: 'low_stock',
        supplierName: 'Acme',
      },
      '2026-09-24'
    )
    expect(row.daysOfCover).toBe(10)
    expect(row.partName).toBe('Motor')
    const bare = toListItem(
      {
        item: item({ partId: 'p2' }),
        partName: null,
        partSku: null,
        stockStatus: null,
        supplierName: null,
      },
      '2026-09-24'
    )
    expect(bare.daysOfCover).toBeNull()
  })
})

describe('supplier facet', () => {
  it('labels suppliers and puts the most items first, ties by name', () => {
    const facet = shapeSupplierFacet(
      [
        { supplierId: 's1', count: 2 },
        { supplierId: 's2', count: 5 },
        { supplierId: 's3', count: 2 },
      ],
      new Map([
        ['s1', 'SteelCo'],
        ['s2', 'Acme'],
        ['s3', 'Bolts Inc'],
      ])
    )
    expect(facet).toEqual([
      { supplierId: 's2', name: 'Acme', count: 5 },
      { supplierId: 's3', name: 'Bolts Inc', count: 2 },
      { supplierId: 's1', name: 'SteelCo', count: 2 },
    ])
  })

  it('keeps a supplier whose record is gone, unnamed', () => {
    expect(shapeSupplierFacet([{ supplierId: 'x', count: 1 }], new Map())).toEqual([
      { supplierId: 'x', name: null, count: 1 },
    ])
  })
})

describe('finished goods above a part', () => {
  const edge = (parentPartId: string, childPartId: string) => ({
    parentPartId,
    childPartId,
    quantity: 1,
  })
  // bolt → frame → bike; bolt → trike; frame → trike; loop a ↔ b under trike
  const parents = buildParentGraph([
    edge('frame', 'bolt'),
    edge('bike', 'frame'),
    edge('trike', 'bolt'),
    edge('trike', 'frame'),
    edge('a', 'b'),
    edge('b', 'a'),
    edge('trike', 'a'),
  ])

  it('lists every top-level finished good above a shared component once', () => {
    expect(finishedGoodsAbove('bolt', parents, false)).toEqual(['bike', 'trike'])
    expect(finishedGoodsAbove('frame', parents, false)).toEqual(['bike', 'trike'])
  })

  it('survives a cycle', () => {
    expect(finishedGoodsAbove('b', parents, false)).toEqual(['trike'])
  })

  it('lists a parentless part as its own finished good only when it is a sold finished good', () => {
    expect(finishedGoodsAbove('bike', parents, true)).toEqual(['bike'])
    expect(finishedGoodsAbove('bike', parents, false)).toEqual([])
    expect(isSoldFinishedGood('finished_good', 0.4)).toBe(true)
    expect(isSoldFinishedGood('finished_good', 0)).toBe(false)
    expect(isSoldFinishedGood('component', 3)).toBe(false)
  })

  it('carries the finished goods onto the list item, empty by default', () => {
    const row = {
      item: item({ partId: 'bolt' }),
      partName: null,
      partSku: null,
      stockStatus: null,
      supplierName: null,
    }
    expect(toListItem(row, '2026-09-24').finishedGoodIds).toEqual([])
    const withProducts = toListItem(row, '2026-09-24', {
      finishedGoodIds: ['bike'],
      finishedGoodNames: ['Bike'],
    })
    expect(withProducts.finishedGoodNames).toEqual(['Bike'])
  })
})

describe('late PO lines', () => {
  it('counts days past the expected date, null when undated or not yet due', () => {
    expect(lateDays('2026-09-20', '2026-09-24')).toBe(4)
    expect(lateDays('2026-09-24', '2026-09-24')).toBeNull()
    expect(lateDays('2026-10-01', '2026-09-24')).toBeNull()
    expect(lateDays(null, '2026-09-24')).toBeNull()
  })
})
