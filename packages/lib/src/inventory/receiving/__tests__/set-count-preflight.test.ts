// packages/lib/src/inventory/receiving/__tests__/set-count-preflight.test.ts
// The shape the Set count dialog reads before it writes (111 Q25).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  nets: new Map<string, number>(),
  earliest: new Map<string, Date | null>(),
  anchored: new Set<string>(),
  bomParents: new Set<string>(),
  parentField: true,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        subpart_parent_part: h.parentField ? { id: 'fld_parent' } : null,
      }),
    }),
  }),
}))
vi.mock('../../costing/dated-reads', () => ({
  readPartNetThrough: async (_org: string, ids: string[]) =>
    new Map(ids.map((id) => [id, h.nets.get(id) ?? 0])),
  readEarliestMovementAt: async (_org: string, ids: string[]) =>
    new Map(ids.map((id) => [id, h.earliest.get(id) ?? null])),
}))
vi.mock('../../movements/initial-queries', () => ({
  readPartInitials: async (_db: unknown, _org: string, ids: string[]) =>
    new Map(ids.filter((id) => h.anchored.has(id)).map((id) => [id, { movementId: `mv_${id}` }])),
}))

import { readSetCountPreflight } from '../set-count-preflight'

const db = {
  selectDistinct: () => {
    const link: Record<string, unknown> = {}
    link.from = () => link
    link.innerJoin = () => link
    link.where = async () => [...h.bomParents].map((partId) => ({ partId }))
    return link
  },
} as never

beforeEach(() => {
  h.nets = new Map()
  h.earliest = new Map()
  h.anchored = new Set()
  h.bomParents = new Set()
  h.parentField = true
})

describe('readSetCountPreflight', () => {
  it('answers one row per part, in the order asked, with the backflush signal on BOM parts only', async () => {
    const earliest = new Date('2026-01-15T00:00:00Z')
    h.nets = new Map([
      ['assembly', -12],
      ['screw', -40],
      ['fresh', 0],
    ])
    h.earliest = new Map([
      ['assembly', earliest],
      ['screw', earliest],
    ])
    h.anchored = new Set(['screw'])
    h.bomParents = new Set(['assembly'])

    const result = await readSetCountPreflight(db, 'org_1', [
      'assembly',
      'screw',
      'fresh',
      'assembly',
    ])
    expect(result._unsafeUnwrap()).toEqual([
      {
        partId: 'assembly',
        hasInitial: false,
        netToday: -12,
        earliest,
        hasBom: true,
        unbuiltSales: 12,
      },
      {
        partId: 'screw',
        hasInitial: true,
        netToday: -40,
        earliest,
        hasBom: false,
        unbuiltSales: 0,
      },
      {
        partId: 'fresh',
        hasInitial: false,
        netToday: 0,
        earliest: null,
        hasBom: false,
        unbuiltSales: 0,
      },
    ])
  })

  it('reports no shortfall for a BOM part whose replay is positive', async () => {
    h.nets = new Map([['assembly', 7]])
    h.bomParents = new Set(['assembly'])
    const [row] = (await readSetCountPreflight(db, 'org_1', ['assembly']))._unsafeUnwrap()
    expect(row).toMatchObject({ hasBom: true, unbuiltSales: 0 })
  })

  it('answers nothing for no parts, and no BOM for an org without the subpart field', async () => {
    expect((await readSetCountPreflight(db, 'org_1', []))._unsafeUnwrap()).toEqual([])
    h.parentField = false
    h.bomParents = new Set(['assembly'])
    const [row] = (await readSetCountPreflight(db, 'org_1', ['assembly']))._unsafeUnwrap()
    expect(row?.hasBom).toBe(false)
  })
})
