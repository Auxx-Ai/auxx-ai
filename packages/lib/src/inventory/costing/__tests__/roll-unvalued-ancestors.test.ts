// packages/lib/src/inventory/costing/__tests__/roll-unvalued-ancestors.test.ts

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  standards: new Map<string, number>(),
  kinds: new Map<string, string>(),
  edges: [] as { parentPartId: string; childPartId: string; quantity: number }[],
  roll: vi.fn(),
}))

vi.mock('../standard-cost-queries', () => ({
  loadStandardCostWriteContext: async () => ({
    allPartIds: new Set(['leaf', 'other', 'sub', 'fg']),
    standardCosts: h.standards,
    partKinds: h.kinds,
  }),
}))
vi.mock('../cost-calculator', () => ({
  loadOrgSubpartEdges: async () => h.edges,
  buildSubpartGraph: (rows: typeof h.edges) => {
    const map = new Map<string, { childId: string; qty: number }[]>()
    for (const row of rows) {
      map.set(row.parentPartId, [
        ...(map.get(row.parentPartId) ?? []),
        { childId: row.childPartId, qty: row.quantity },
      ])
    }
    return map
  },
  buildParentGraph: (rows: typeof h.edges) => {
    const map = new Map<string, string[]>()
    for (const row of rows) {
      map.set(row.childPartId, [...(map.get(row.childPartId) ?? []), row.parentPartId])
    }
    return map
  },
}))
vi.mock('../standard-cost', () => ({ rollStandardCost: h.roll }))

import { rollUnvaluedAncestors } from '../roll-unvalued-ancestors'

const db = {} as never
const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  // leaf + other -> sub -> fg
  h.edges = [
    { parentPartId: 'sub', childPartId: 'leaf', quantity: 1 },
    { parentPartId: 'sub', childPartId: 'other', quantity: 2 },
    { parentPartId: 'fg', childPartId: 'sub', quantity: 1 },
  ]
  h.kinds = new Map([
    ['leaf', 'component'],
    ['other', 'component'],
    ['sub', 'subassembly'],
    ['fg', 'finished_good'],
  ])
  h.standards = new Map([['leaf', 100]])
  h.roll.mockImplementation(async (_db, _org, _user, input: { partIds: string[] }) =>
    ok({ writtenPartIds: input.partIds })
  )
})

describe('rollUnvaluedAncestors', () => {
  it('rolls every unvalued parent once its last leaf is costed', async () => {
    h.standards.set('other', 50)

    const result = await rollUnvaluedAncestors(db, ORG, 'u1', ['leaf'])

    expect(result._unsafeUnwrap()).toEqual(['sub', 'fg'])
    expect(h.roll).toHaveBeenCalledTimes(1)
    expect(h.roll.mock.calls[0]![2]).toBe('u1')
    expect(h.roll.mock.calls[0]![3].partIds).toEqual(['sub', 'fg'])
  })

  it('rolls nothing while another leaf has no standard, so no leaf cost is inferred', async () => {
    const result = await rollUnvaluedAncestors(db, ORG, 'u1', ['leaf'])

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.roll).not.toHaveBeenCalled()
  })

  it('leaves out an ancestor that already has a standard', async () => {
    h.standards.set('other', 50)
    h.standards.set('fg', 999)

    await rollUnvaluedAncestors(db, ORG, 'u1', ['leaf'])

    expect(h.roll.mock.calls[0]![3].partIds).toEqual(['sub'])
  })

  it('does nothing for a part with no parents', async () => {
    const result = await rollUnvaluedAncestors(db, ORG, 'u1', ['fg'])

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.roll).not.toHaveBeenCalled()
  })
})
