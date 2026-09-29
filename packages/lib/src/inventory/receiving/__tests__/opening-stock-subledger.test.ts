// packages/lib/src/inventory/receiving/__tests__/opening-stock-subledger.test.ts
//
// The parts' value at the cutover (111 Q23): every movement ≤ cutover over anchored parts,
// unanchored parts listed with their throughput, unvalued rows counted and left out.
// The org cache and the drizzle chain are doubles, so nothing here needs a database.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defs: new Map<string, string>(),
  rows: [] as Array<{
    partId: string
    role: string | null
    hasInitial: boolean
    netQty: string | number
    valueMinor: string | number
    unvalued: string | number
  }>,
  names: new Map<string, string>(),
  readNamesFor: [] as string[][],
  queries: 0,
}))

vi.mock('../../../resources/system-records', () => ({
  systemDefId: async (_db: unknown, _org: string, entityType: string) =>
    h.defs.get(entityType) ?? null,
  readSystemRecords: async (
    _db: unknown,
    _org: string,
    _ctx: unknown,
    options: { ids: string[] }
  ) => {
    h.readNamesFor.push(options.ids)
    return options.ids
      .filter((id) => h.names.has(id))
      .map((id) => ({ id, displayName: h.names.get(id) ?? null }))
  },
}))

import { readPartsValueAtCutover } from '../opening-stock-subledger'

const ORG = 'org_1'

const db = { select: () => chain() } as never

function chain() {
  h.queries += 1
  const link: Record<string, unknown> = {}
  for (const step of ['from', 'where', 'groupBy']) link[step] = () => link
  // biome-ignore lint/suspicious/noThenProperty: the double stands in for a drizzle query builder, which IS awaitable
  link.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(h.rows as unknown[]).then(resolve, reject)
  return link
}

beforeEach(() => {
  h.defs = new Map([['part', 'def_part']])
  h.rows = []
  h.names = new Map([
    ['p_bolt', 'Bolt'],
    ['p_nut', 'Nut'],
    ['p_gear', 'Gear'],
  ])
  h.readNamesFor = []
  h.queries = 0
})

describe('readPartsValueAtCutover', () => {
  it('sums every movement ≤ cutover over anchored parts, per frozen role', async () => {
    h.rows = [
      // Bolt: an initial of 12 at 100.00 plus two sales of 1 at 100.00 each, all raw materials.
      {
        partId: 'p_bolt',
        role: 'inventory_raw_materials',
        hasInitial: true,
        netQty: '10',
        valueMinor: '100000',
        unvalued: '0',
      },
      // Gear: finished goods, anchored.
      {
        partId: 'p_gear',
        role: 'inventory_finished_goods',
        hasInitial: true,
        netQty: 3,
        valueMinor: 60000,
        unvalued: 0,
      },
    ]
    const value = (
      await readPartsValueAtCutover(db, ORG, { onOrBefore: '2026-12-31' })
    )._unsafeUnwrap()

    expect(value.byRole).toEqual({
      inventory_raw_materials: 100_000,
      inventory_wip: 0,
      inventory_finished_goods: 60_000,
    })
    expect(value.totalMinor).toBe(160_000)
    expect(value.byPart).toEqual([
      { partId: 'p_bolt', name: 'Bolt', qtyAtCutover: 10, valueMinor: 100_000 },
      { partId: 'p_gear', name: 'Gear', qtyAtCutover: 3, valueMinor: 60_000 },
    ])
    expect(value.uncounted).toEqual([])
    expect(value.pendingRows).toBe(0)
    expect(h.readNamesFor).toEqual([['p_bolt', 'p_gear']])
  })

  it('excludes a part with movements and no initial, and lists it with its throughput', async () => {
    h.rows = [
      {
        partId: 'p_bolt',
        role: 'inventory_raw_materials',
        hasInitial: true,
        netQty: 10,
        valueMinor: 100_000,
        unvalued: 0,
      },
      // Nut: 40 sold before the cutover, never counted. Its relief was valued, and must not count.
      {
        partId: 'p_nut',
        role: 'inventory_raw_materials',
        hasInitial: false,
        netQty: -40,
        valueMinor: -8_000,
        unvalued: 0,
      },
    ]
    const value = (
      await readPartsValueAtCutover(db, ORG, { onOrBefore: '2026-12-31' })
    )._unsafeUnwrap()

    expect(value.totalMinor).toBe(100_000)
    expect(value.byPart.map((row) => row.partId)).toEqual(['p_bolt'])
    expect(value.uncounted).toEqual([{ partId: 'p_nut', name: 'Nut', throughputAtCutover: 40 }])
  })

  it('folds the (part, role) groups of one part together and counts its unvalued rows', async () => {
    h.rows = [
      {
        partId: 'p_bolt',
        role: 'inventory_raw_materials',
        hasInitial: true,
        netQty: 10,
        valueMinor: 100_000,
        unvalued: 0,
      },
      // Two pending rows on Bolt after it was reclassified: grouped under a null role by SQL.
      { partId: 'p_bolt', role: null, hasInitial: false, netQty: -2, valueMinor: 0, unvalued: 2 },
      {
        partId: 'p_bolt',
        role: 'inventory_finished_goods',
        hasInitial: false,
        netQty: 1,
        valueMinor: 5_000,
        unvalued: 0,
      },
    ]
    const value = (
      await readPartsValueAtCutover(db, ORG, { onOrBefore: '2026-12-31' })
    )._unsafeUnwrap()

    expect(value.byPart).toEqual([
      { partId: 'p_bolt', name: 'Bolt', qtyAtCutover: 9, valueMinor: 105_000 },
    ])
    expect(value.byRole).toEqual({
      inventory_raw_materials: 100_000,
      inventory_wip: 0,
      inventory_finished_goods: 5_000,
    })
    expect(value.pendingRows).toBe(2)
  })

  it('falls back to the part id when the part has no display name', async () => {
    h.rows = [
      {
        partId: 'p_unknown',
        role: 'inventory_raw_materials',
        hasInitial: true,
        netQty: 1,
        valueMinor: 100,
        unvalued: 0,
      },
    ]
    const value = (
      await readPartsValueAtCutover(db, ORG, { onOrBefore: '2026-12-31' })
    )._unsafeUnwrap()
    expect(value.byPart[0]?.name).toBe('p_unknown')
  })
})
