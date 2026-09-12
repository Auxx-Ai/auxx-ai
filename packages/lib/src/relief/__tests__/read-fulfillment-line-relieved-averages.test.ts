// packages/lib/src/relief/__tests__/read-fulfillment-line-relieved-averages.test.ts
//
// Pins the two things a canned-result mock cannot catch (brief 50 §3.5):
//
// 1. The SUM is scoped to `stock_movement_type = 'sale'` as an INNER JOIN,
//    matching field-hooks/post/fulfillment-line-rollups.ts's readTotalsByLine
//    predicate exactly. reverse-movement.ts maps a reversed `sale` to
//    `return_in` - the same label brief 54's customer returns will use - and
//    counting it here would read a correction as un-relief and re-relieve the
//    same units on the next sync.
// 2. The sign handling: a `sale` movement's quantity AND extended cost are
//    both negative, both outputs here are positive, and a net-zero SUM's
//    `-0` must normalize to a plain `0` (the exact bug
//    fulfillment-line-rollups.ts documents and fixes the same way).
//
// The fake `db.select` inspects the bound parameters of the actual join
// conditions - the technique fulfillment-line-rollups-scope.test.ts
// established - and executes the SUM against an in-memory ledger. If the
// production query stopped scoping by type, this fake would fall back to
// summing every movement type and the assertions below would fail.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const LINE_A = 'fline-a'
const LINE_B = 'fline-b'

const FIELD_IDS = {
  lineRel: 'fld-line',
  type: 'fld-type',
  quantity: 'fld-qty',
  extendedCost: 'fld-cost',
}

const FIELDS: Record<string, { id: string; type: string } | null> = {
  stock_movement_fulfillment_line: { id: FIELD_IDS.lineRel, type: 'RELATIONSHIP' },
  stock_movement_type: { id: FIELD_IDS.type, type: 'SINGLE_SELECT' },
  stock_movement_quantity: { id: FIELD_IDS.quantity, type: 'NUMBER' },
  stock_movement_extended_cost: { id: FIELD_IDS.extendedCost, type: 'CURRENCY' },
}

/** One committed `stock_movement` row in the fixture ledger. */
interface FixtureMovement {
  lineId: string
  type: string
  quantity: number
  extendedCost: number
}

const h = vi.hoisted(() => ({
  movements: [] as FixtureMovement[],
  fieldsMissing: false,
}))

/** See read-part-ledger-averages.test.ts for provenance of this walker. */
function boundStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) boundStrings(child, out)
    return out
  }
  const record = node as Record<string, unknown>
  if (Array.isArray(record.queryChunks)) return boundStrings(record.queryChunks, out)
  if (typeof record.value === 'string') out.push(record.value)
  return out
}

/**
 * Executes the grouped SUM against the fixture ledger using ONLY what the
 * captured join parameters actually name: which line ids the fv_line join
 * restricted to, and whether the fv_type join carries the real `sale`
 * literal. A dropped or loosened type scope makes every movement type count,
 * exactly as it would against a real database.
 */
function routeSum(
  params: string[],
  saleLiteral: string
): Array<{ lineId: string; quantity: string; valueMinor: string }> {
  // Typed explicitly: TS 5.5+ infers an automatic type predicate for this
  // filter (narrowing to the literal union of LINE_A/LINE_B), which would
  // make `.has(m.lineId)` below reject the wider `string` type.
  const requestedIds = new Set<string>(params.filter((p) => p === LINE_A || p === LINE_B))
  const typeScoped = params.includes(saleLiteral)

  const groups = new Map<string, { quantity: number; valueMinor: number }>()
  for (const m of h.movements) {
    if (!requestedIds.has(m.lineId)) continue
    if (typeScoped && m.type !== saleLiteral) continue
    const g = groups.get(m.lineId) ?? { quantity: 0, valueMinor: 0 }
    g.quantity += m.quantity
    g.valueMinor += m.extendedCost
    groups.set(m.lineId, g)
  }

  return [...groups.entries()].map(([lineId, g]) => ({
    lineId,
    quantity: String(g.quantity),
    valueMinor: String(g.valueMinor),
  }))
}

/** Chainable Drizzle stub whose join conditions are inspected, not ignored. */
function chain(route: (params: string[]) => unknown[]) {
  const params: string[] = []
  const node: Record<string, unknown> = {}
  for (const key of ['select', 'from', 'where', 'groupBy']) node[key] = () => node
  for (const key of ['innerJoin', 'leftJoin']) {
    node[key] = (_alias: unknown, condition: unknown) => {
      boundStrings(condition, params)
      return node
    }
  }
  node.then = (resolve: (v: unknown) => unknown) => Promise.resolve(route(params)).then(resolve)
  return node
}

vi.mock('@auxx/database', () => ({
  schema: {
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      relatedEntityId: 'relatedEntityId',
    },
  },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [attr, h.fieldsMissing ? null : (FIELDS[attr] ?? null)])
        ),
    }),
  }),
}))

import type { Database } from '@auxx/database'
import { StockMovementType } from '../../resources/registry/enum-values'
import { readFulfillmentLineRelievedAverages } from '../cost-reads'

const fakeDb = {
  select: () => chain((params) => routeSum(params, StockMovementType.SALE)),
} as unknown as Database

beforeEach(() => {
  h.movements = []
  h.fieldsMissing = false
})

describe('readFulfillmentLineRelievedAverages', () => {
  it('empty input returns an empty Map without touching the database', async () => {
    const selectSpy = vi.fn()
    const db = { select: selectSpy } as unknown as Database

    const result = await readFulfillmentLineRelievedAverages(db, {
      organizationId: ORG,
      fulfillmentLineIds: [],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.size).toBe(0)
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('🛑 excludes a return_in reversal of the sale it is undoing', async () => {
    h.movements = [
      { lineId: LINE_A, type: StockMovementType.SALE, quantity: -5, extendedCost: -20_000 },
      // reverse-movement.ts writes the undo of a `sale` as `return_in`, never
      // `sale` (REVERSAL_TYPE_BY_ORIGINAL). Counting it here would read the
      // correction as un-relief and re-relieve the same 5 units next sync.
      { lineId: LINE_A, type: 'return_in', quantity: 5, extendedCost: 20_000 },
    ]

    const result = await readFulfillmentLineRelievedAverages(fakeDb, {
      organizationId: ORG,
      fulfillmentLineIds: [LINE_A],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.get(LINE_A)).toEqual({
      fulfillmentLineId: LINE_A,
      relievedQuantity: 5,
      relievedValueMinor: 20_000,
      unitCostMinor: 4_000,
    })
  })

  it('nets two sale-typed rows in opposite directions - a relief and an un-relieving correction', async () => {
    h.movements = [
      { lineId: LINE_A, type: StockMovementType.SALE, quantity: -5, extendedCost: -20_000 },
      // A correction that is itself typed `sale` (not a reverseMovement
      // reversal) giving 2 units back at the same frozen price.
      { lineId: LINE_A, type: StockMovementType.SALE, quantity: 2, extendedCost: 8_000 },
    ]

    const result = await readFulfillmentLineRelievedAverages(fakeDb, {
      organizationId: ORG,
      fulfillmentLineIds: [LINE_A],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.get(LINE_A)).toEqual({
      fulfillmentLineId: LINE_A,
      relievedQuantity: 3,
      relievedValueMinor: 12_000,
      unitCostMinor: 4_000,
    })
  })

  it('a fully un-relieved line nets to a plain 0, not -0, and carries no unit cost', async () => {
    h.movements = [
      { lineId: LINE_A, type: StockMovementType.SALE, quantity: -5, extendedCost: -20_000 },
      { lineId: LINE_A, type: StockMovementType.SALE, quantity: 5, extendedCost: 20_000 },
    ]

    const result = await readFulfillmentLineRelievedAverages(fakeDb, {
      organizationId: ORG,
      fulfillmentLineIds: [LINE_A],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    const entry = result.value.get(LINE_A)
    expect(entry).toEqual({
      fulfillmentLineId: LINE_A,
      relievedQuantity: 0,
      relievedValueMinor: 0,
      unitCostMinor: null,
    })
    // `-0 === 0` arithmetically but is deep-unequal under Object.is - assert
    // the guard actually normalized it, not just that it compares equal.
    expect(Object.is(entry?.relievedQuantity, -0)).toBe(false)
    expect(Object.is(entry?.relievedValueMinor, -0)).toBe(false)
  })

  it('ignores a receive/build movement carrying the same fulfillment line id', async () => {
    h.movements = [
      { lineId: LINE_A, type: StockMovementType.SALE, quantity: -4, extendedCost: -16_000 },
      { lineId: LINE_A, type: 'build_consume', quantity: -100, extendedCost: -500_000 },
    ]

    const result = await readFulfillmentLineRelievedAverages(fakeDb, {
      organizationId: ORG,
      fulfillmentLineIds: [LINE_A],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.get(LINE_A)).toEqual({
      fulfillmentLineId: LINE_A,
      relievedQuantity: 4,
      relievedValueMinor: 16_000,
      unitCostMinor: 4_000,
    })
  })

  it('a line with no sale movements at all is ABSENT from the Map, not a zero row', async () => {
    h.movements = [
      { lineId: LINE_A, type: StockMovementType.SALE, quantity: -4, extendedCost: -16_000 },
    ]

    const result = await readFulfillmentLineRelievedAverages(fakeDb, {
      organizationId: ORG,
      fulfillmentLineIds: [LINE_A, LINE_B],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.has(LINE_A)).toBe(true)
    expect(result.value.has(LINE_B)).toBe(false)
  })

  it('returns an error result when the org has not provisioned the required stock_movement fields', async () => {
    h.fieldsMissing = true

    const result = await readFulfillmentLineRelievedAverages(fakeDb, {
      organizationId: ORG,
      fulfillmentLineIds: [LINE_A],
    })

    expect(result.isErr()).toBe(true)
  })
})
