// packages/lib/src/inventory/costing/__tests__/standard-cost-worklist.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  records: [] as Array<{ id: string; displayName: string | null; cells: Record<string, unknown> }>,
  edges: [] as Array<{ parentPartId: string; childPartId: string; quantity: number }>,
}))

vi.mock('../../../cache', () => ({
  requireCachedEntityDefId: vi.fn(async () => 'def_part'),
}))
vi.mock('../../../resources/system-records', () => ({
  systemFieldMap: vi.fn(async () => ({})),
  readSystemRecords: vi.fn(async () =>
    h.records.map((record) => ({
      id: record.id,
      displayName: record.displayName,
      text: (a: string) => (record.cells[a] as string | undefined) ?? null,
      number: (a: string) => (record.cells[a] as number | undefined) ?? null,
      option: (a: string) => (record.cells[a] as string | undefined) ?? null,
    }))
  ),
}))
vi.mock('../cost-calculator', () => ({
  loadOrgSubpartEdges: vi.fn(async () => h.edges),
}))

import {
  buildStandardCostWorklist,
  readStandardCostWorklist,
  type WorklistPartFacts,
} from '../standard-cost-worklist'

const part = (partId: string, over: Partial<WorklistPartFacts> = {}): WorklistPartFacts => ({
  partId,
  name: partId,
  sku: null,
  kind: 'component',
  standardCost: null,
  standardCostSource: null,
  standardCostOrigin: null,
  purchaseCost: null,
  channelCost: null,
  ...over,
})
const edge = (parentPartId: string, childPartId: string) => ({
  parentPartId,
  childPartId,
  quantity: 1,
})

// FG -> SUB -> {A, B}; FG -> C (costed); FG2 -> A; SUB2 (costed) -> D
const facts = [
  part('FG', { kind: 'finished_good' }),
  part('FG2', { kind: 'finished_good' }),
  part('SUB', { kind: 'subassembly' }),
  part('A'),
  part('B'),
  part('C', { standardCost: 500, standardCostOrigin: 'manual' }),
  part('SUB2', { kind: 'subassembly', standardCost: 900 }),
  part('D'),
  part('SVC', { kind: 'service' }),
]
const edges = [
  edge('FG', 'SUB'),
  edge('SUB', 'A'),
  edge('SUB', 'B'),
  edge('SUB', 'SVC'),
  edge('FG', 'C'),
  edge('FG', 'SUB2'),
  edge('SUB2', 'D'),
  edge('FG2', 'A'),
]

describe('buildStandardCostWorklist', () => {
  it('lists requested parts, then each uncosted leaf once, walking through unvalued subassemblies', () => {
    const rows = buildStandardCostWorklist(facts, edges, ['FG', 'FG2'])
    expect(rows.map((row) => [row.partId, row.isLeaf])).toEqual([
      ['FG', false],
      ['FG2', false],
      ['A', true],
      ['B', true],
    ])
    const fg = rows[0]
    expect(fg).toMatchObject({ hasBom: true, uncostedLeafCount: 2, usedIn: 0 })
    expect(rows.find((row) => row.partId === 'A')).toMatchObject({ usedIn: 2, hasBom: false })
  })

  it('stops at a costed child and never lists a service', () => {
    const rows = buildStandardCostWorklist(facts, edges, ['SUB2', 'SUB'])
    expect(rows.map((row) => row.partId)).toEqual(['SUB2', 'SUB', 'A', 'B'])
    expect(rows[0]).toMatchObject({ uncostedLeafCount: 1 })
  })

  it('does not repeat a leaf that was asked for itself', () => {
    const rows = buildStandardCostWorklist(facts, edges, ['FG', 'A'])
    expect(rows.map((row) => [row.partId, row.isLeaf])).toEqual([
      ['FG', false],
      ['A', false],
      ['B', true],
    ])
  })

  it('without a request returns every stocked part and survives a BOM cycle', () => {
    const rows = buildStandardCostWorklist(
      [part('X', { kind: 'subassembly' }), part('Y', { kind: 'subassembly' }), part('Z')],
      [edge('X', 'Y'), edge('Y', 'X'), edge('Y', 'Z')]
    )
    expect(rows.map((row) => [row.partId, row.uncostedLeafCount])).toEqual([
      ['X', 1],
      ['Y', 1],
      ['Z', 0],
    ])
    expect(buildStandardCostWorklist(facts, edges).some((row) => row.kind === 'service')).toBe(
      false
    )
  })
})

describe('readStandardCostWorklist', () => {
  beforeEach(() => {
    h.records = []
    h.edges = []
  })

  it('reads the stored fields, and an origin-less zero is no standard', async () => {
    h.records = [
      {
        id: 'P',
        displayName: 'Plate',
        cells: {
          part_kind: 'finished_good',
          part_standard_cost: 0,
          part_purchase_cost: 420,
          part_channel_cost: 1000,
        },
      },
      {
        id: 'Q',
        displayName: null,
        cells: {
          part_standard_cost: 0,
          part_standard_cost_origin: 'manual',
          part_standard_cost_source: 'provisional',
        },
      },
    ]
    const result = await readStandardCostWorklist({} as never, 'org_1')
    expect(result._unsafeUnwrap()).toEqual([
      expect.objectContaining({
        partId: 'P',
        name: 'Plate',
        kind: 'finished_good',
        standardCost: null,
        purchaseCost: 420,
        channelCost: 1000,
        hasBom: false,
      }),
      expect.objectContaining({
        partId: 'Q',
        name: '',
        standardCost: 0,
        standardCostOrigin: 'manual',
        standardCostSource: 'provisional',
      }),
    ])
  })
})
