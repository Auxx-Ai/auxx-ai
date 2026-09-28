// packages/lib/src/inventory/receiving/__tests__/movement-coverage.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  materialised: new Set<string>(),
  executeRows: [] as Array<{ id: string | null }>,
  distinctRows: [] as Array<{ partId: string | null }>,
  statements: 0,
}))

vi.mock('../../../resources/system-records', () => ({
  systemFieldMap: async (_db: unknown, _org: string, attrs: readonly string[]) =>
    Object.fromEntries(attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])),
}))

import { readPartsWithInitialMovement, readPartsWithMovements } from '../movement-coverage'

function chain(rows: unknown[]) {
  const link: Record<string, unknown> = {}
  link.from = () => link
  link.innerJoin = () => link
  link.where = () => link
  // biome-ignore lint/suspicious/noThenProperty: stands in for an awaitable drizzle builder
  link.then = (resolve: (r: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)
  return link
}

const db = {
  execute: async () => {
    h.statements += 1
    return { rows: h.executeRows }
  },
  selectDistinct: () => {
    h.statements += 1
    return chain(h.distinctRows)
  },
} as never

beforeEach(() => {
  h.materialised = new Set(['stock_movement_part', 'stock_movement_type'])
  h.executeRows = []
  h.distinctRows = []
  h.statements = 0
})

describe('readPartsWithMovements', () => {
  it('answers every moved part in one statement, whatever the movement count', async () => {
    h.executeRows = [{ id: 'part_1' }, { id: 'part_2' }, { id: null }]
    expect(await readPartsWithMovements(db, 'org_1')).toEqual(new Set(['part_1', 'part_2']))
    expect(h.statements).toBe(1)
  })

  it('reads nothing and reports no part as moved without the movement part link', async () => {
    h.materialised.delete('stock_movement_part')
    h.executeRows = [{ id: 'part_1' }]
    expect(await readPartsWithMovements(db, 'org_1')).toEqual(new Set())
    expect(h.statements).toBe(0)
  })
})

describe('readPartsWithInitialMovement', () => {
  it('answers the parts that carry an initial', async () => {
    h.distinctRows = [{ partId: 'part_1' }, { partId: null }]
    expect(await readPartsWithInitialMovement(db, 'org_1')).toEqual(new Set(['part_1']))
  })

  it('reads nothing without the movement type field', async () => {
    h.materialised.delete('stock_movement_type')
    expect(await readPartsWithInitialMovement(db, 'org_1')).toEqual(new Set())
    expect(h.statements).toBe(0)
  })
})
