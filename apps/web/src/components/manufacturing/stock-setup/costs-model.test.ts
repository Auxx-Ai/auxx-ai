// apps/web/src/components/manufacturing/stock-setup/costs-model.test.ts

import { describe, expect, it } from 'vitest'
import {
  type CostRow,
  type CostWorklistPart,
  groupBySupplier,
  matchesCostFilter,
  parseCostFilter,
  planSourceAction,
  sortCostRows,
  sourceActionCount,
  sourcePlanLine,
  toCostRow,
  waitingProducts,
} from './costs-model'

function part(overrides: Partial<CostWorklistPart> = {}): CostWorklistPart {
  return {
    partId: 'motor',
    name: 'Motor',
    sku: null,
    kind: 'component',
    hasBom: false,
    standardCost: null,
    standardCostSource: null,
    standardCostOrigin: null,
    purchaseCost: null,
    channelCost: null,
    quantityOnHand: 0,
    usedIn: 0,
    uncostedLeafCount: 0,
    uncostedLeafIds: [],
    supplierId: null,
    supplierName: null,
    isLeaf: false,
    moved: true,
    needed: true,
    ...overrides,
  }
}

const row = (overrides: Partial<CostWorklistPart> = {}): CostRow => toCostRow(part(overrides))

describe('toCostRow', () => {
  it('reads no standard as no cost, and a $0 source as no source', () => {
    const r = row({ purchaseCost: 0, channelCost: 500 })
    expect(r.state).toBe('none')
    expect(r.supplierCost).toBeNull()
    expect(r.suggestion).toMatchObject({ unitCost: 500, source: 'channel' })
  })

  it('reads a confirmed and a sourceless standard', () => {
    expect(row({ standardCost: 100, standardCostSource: 'confirmed' }).state).toBe('confirmed')
    expect(row({ standardCost: 100, standardCostSource: 'provisional' }).state).toBe('provisional')
    expect(row({ standardCost: 100, standardCostSource: null }).state).toBe('provisional')
  })

  it('never suggests a cost for a part with a BOM', () => {
    expect(row({ hasBom: true, purchaseCost: 900 }).suggestion).toBeNull()
  })
})

describe('sortCostRows / filters', () => {
  it('puts the most-used parts first, then by name', () => {
    const sorted = sortCostRows([
      row({ partId: 'b', name: 'B', usedIn: 1 }),
      row({ partId: 'a', name: 'A', usedIn: 1 }),
      row({ partId: 'c', name: 'C', usedIn: 41 }),
    ])
    expect(sorted.map((r) => r.partId)).toEqual(['c', 'a', 'b'])
  })

  it('matches each filter', () => {
    const differ = row({ purchaseCost: 18240, channelCost: 19900 })
    expect(matchesCostFilter(differ, 'differ')).toBe(true)
    expect(matchesCostFilter(row({ purchaseCost: 5, channelCost: 5 }), 'differ')).toBe(false)
    expect(matchesCostFilter(row({ needed: false }), 'not-used')).toBe(true)
    expect(matchesCostFilter(row({ standardCost: 1 }), 'no-cost')).toBe(false)
    expect(parseCostFilter('no-cost')).toBe('no-cost')
    expect(parseCostFilter('uncosted')).toBe('all')
  })
})

describe('planSourceAction (22 §3.3)', () => {
  const rows = [
    row({ partId: 'first', purchaseCost: 18240 }),
    row({
      partId: 'same',
      purchaseCost: 185,
      standardCost: 185,
      standardCostSource: 'provisional',
    }),
    row({ partId: 'done', purchaseCost: 185, standardCost: 185, standardCostSource: 'confirmed' }),
    row({
      partId: 'change',
      purchaseCost: 18240,
      standardCost: 19900,
      standardCostSource: 'confirmed',
      quantityOnHand: 10,
    }),
    row({ partId: 'none' }),
  ]

  it('splits first costs, confirms, changes and skips, with the revaluation', () => {
    const plan = planSourceAction(rows, 'supplier')
    expect(plan.firstCosts.map((f) => [f.row.partId, f.to])).toEqual([['first', 18240]])
    expect(plan.confirms.map((r) => r.partId)).toEqual(['same'])
    expect(plan.unchanged.map((r) => r.partId)).toEqual(['done'])
    expect(plan.changes.map((c) => [c.row.partId, c.from, c.to])).toEqual([
      ['change', 19900, 18240],
    ])
    expect(plan.skipped.map((r) => r.partId)).toEqual(['none'])
    expect(plan.revaluationMinor).toBe(-16600)
    expect(sourcePlanLine(plan)).toBe('1 first cost · 1 confirmed as they are · 1 change')
    expect(sourceActionCount(rows, 'supplier')).toBe(3)
  })

  it('confirm current keeps every amount and skips parts with no cost', () => {
    const plan = planSourceAction(rows, 'current')
    expect(plan.firstCosts).toEqual([])
    expect(plan.changes).toEqual([])
    expect(plan.confirms.map((r) => r.partId)).toEqual(['same'])
    expect(plan.skipped.map((r) => r.partId)).toEqual(['first', 'none'])
  })

  it('skips a part with a BOM from every source', () => {
    const plan = planSourceAction([row({ hasBom: true, purchaseCost: 900 })], 'supplier')
    expect(plan.skipped).toHaveLength(1)
  })
})

describe('waitingProducts', () => {
  it('names the uncosted parts each uncosted product waits on', () => {
    const parts = [
      part({ partId: 'lift', name: 'Auxx-Lift', hasBom: true, uncostedLeafIds: ['nut', 'cable'] }),
      part({ partId: 'nut', name: 'Square Nut M5' }),
      part({ partId: 'cable', name: 'Cable Extension' }),
      part({ partId: 'kit', name: 'Kit', hasBom: true, standardCost: 100 }),
    ]
    expect(waitingProducts(parts)).toEqual([
      { partId: 'lift', name: 'Auxx-Lift', waitingOn: ['Cable Extension', 'Square Nut M5'] },
    ])
  })
})

describe('groupBySupplier (22 §3.5)', () => {
  it('groups by supplier name, keeps row order, and puts parts with no supplier last', () => {
    const groups = groupBySupplier([
      row({ partId: 'a', supplierId: 's2', supplierName: 'Zeta Supply' }),
      row({ partId: 'b' }),
      row({ partId: 'c', supplierId: 's1', supplierName: 'Acme', standardCost: 5 }),
      row({ partId: 'd', supplierId: 's2', supplierName: 'Zeta Supply' }),
    ])
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.partId), g.withoutCost])).toEqual([
      ['Acme', ['c'], 0],
      ['Zeta Supply', ['a', 'd'], 2],
      ['No supplier', ['b'], 1],
    ])
  })
})
