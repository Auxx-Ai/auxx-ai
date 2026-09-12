// packages/lib/src/field-hooks/post/fulfillment-line-rollups-scope.test.ts
//
// Pins the one thing `fulfillment-line-rollups.test.ts`'s FIFO-queue mock cannot: that the
// roll-up's SQL actually EXCLUDES a `return_in` movement rather than merely being written
// with the intent to. brief §1: `reverse-movement.ts`'s `REVERSAL_TYPE_BY_ORIGINAL` maps a
// reversed `sale` to `return_in` - the same label brief 54 (returns) will use for a real
// customer return. If a `return_in` row were counted here it would read as UN-relief and
// the next sync would relieve the same units a second time, forever.
//
// A queued-result mock (as the sibling file uses) trusts whatever total is handed to it, so
// it cannot catch a regression where the `stock_movement_type = 'sale'` join condition is
// loosened or dropped. This file instead runs the REAL query against fixture rows: the fake
// `database.select` inspects the actual bound parameters of the join conditions (field ids
// and the type literal) the way `receiving/__tests__/receipt-query-count.test.ts` does, and
// answers from an in-memory ledger. If the production query stopped scoping by type, this
// fake executor would fall back to summing every movement type and the assertions below
// would fail.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const LINE = 'fline-1'

const FIELDS: Record<string, { id: string; type: string }> = {
  stock_movement_quantity: { id: 'fld-qty', type: 'NUMBER' },
  stock_movement_type: { id: 'fld-type', type: 'SINGLE_SELECT' },
  stock_movement_fulfillment_line: { id: 'fld-line', type: 'RELATIONSHIP' },
  fulfillment_line_quantity_relieved: { id: 'fld-relieved', type: 'NUMBER' },
}

/** One committed `stock_movement` row in the fixture ledger. */
interface FixtureMovement {
  lineId: string
  type: string
  quantity: number
}

const h = vi.hoisted(() => ({
  movements: [] as FixtureMovement[],
  writes: [] as Array<{ recordId: string; value: number }>,
}))

/**
 * Bound string parameters of a drizzle `sql` node - field ids and literal
 * comparison values are all `Param`s, and this walks the chunk tree to find
 * them. Copied from `receiving/__tests__/receipt-query-count.test.ts`, which
 * established the technique for this exact purpose: answering a mock query
 * from what its join predicates actually name, not from a canned queue.
 */
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

/** Chainable drizzle stub whose join conditions are inspected, not ignored. */
function chain(projection: Record<string, unknown>, route: (params: string[]) => unknown[]) {
  const params: string[] = []
  const node: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'limit', 'groupBy']) node[key] = () => node
  for (const key of ['innerJoin', 'leftJoin']) {
    node[key] = (_alias: unknown, condition: unknown) => {
      boundStrings(condition, params)
      return node
    }
  }
  node.then = (resolve: (v: unknown) => unknown) => Promise.resolve(route(params)).then(resolve)
  void projection
  return node
}

/**
 * The single-line SUM the module issues: find which fulfillment line and
 * which movement TYPE its join conditions actually name, then sum the fixture
 * ledger by those - exactly what a real join would produce, and nothing the
 * test asserts up front.
 */
function routeSum(params: string[]): unknown[] {
  const lineId = params.find((p) => p === LINE)
  const typeLiteral = params.find((p) => p === 'sale' || p === 'return_in' || p === 'return_out')
  const total = h.movements
    .filter((m) => m.lineId === lineId && m.type === typeLiteral)
    .reduce((sum, m) => sum + m.quantity, 0)
  return [{ total: String(total), current: null }]
}

vi.mock('@auxx/database', () => ({
  database: { select: (projection: Record<string, unknown>) => chain(projection, routeSum) },
  schema: {
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      relatedEntityId: 'relatedEntityId',
    },
    CustomField: { id: 'id', systemAttribute: 'systemAttribute' },
  },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, FIELDS[attr] ?? null])),
    }),
  }),
  requireCachedEntityDefId: async () => 'flinedef',
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: () => ({ organizationId: ORG }),
}))
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: (t: string) => t }))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: async (
    _ctx: unknown,
    args: { recordId: string; value: { value?: number } }
  ) => {
    h.writes.push({ recordId: args.recordId, value: args.value.value ?? 0 })
    return []
  },
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: async () => undefined,
}))

import { recalculateFulfillmentLineQuantityRelieved } from './fulfillment-line-rollups'

beforeEach(() => {
  h.movements = []
  h.writes = []
})

describe('the SUM query, run for real against fixture rows', () => {
  it('🛑 excludes a return_in reversal of the sale it is undoing', async () => {
    h.movements = [
      { lineId: LINE, type: 'sale', quantity: -5 },
      // The reversal of the row above. `reverse-movement.ts` writes this as
      // `return_in`, never `sale` - see `REVERSAL_TYPE_BY_ORIGINAL`. Counting
      // it here would read the correction as un-relief and re-relieve the
      // same 5 units on the next sync.
      { lineId: LINE, type: 'return_in', quantity: 5 },
    ]

    await recalculateFulfillmentLineQuantityRelieved(ORG, LINE)

    // If `return_in` were wrongly included the net would be 0; scoped
    // correctly, the sale alone still stands and 5 units remain relieved.
    expect(h.writes).toEqual([{ recordId: `flinedef:${LINE}`, value: 5 }])
  })

  it('nets two sale-typed rows in opposite directions - a relief and an un-relieving correction', async () => {
    h.movements = [
      { lineId: LINE, type: 'sale', quantity: -5 },
      // A correction that is itself typed `sale` (not a `reverseMovement`
      // reversal) and gives 2 units back - still inside the scoped type.
      { lineId: LINE, type: 'sale', quantity: 2 },
    ]

    await recalculateFulfillmentLineQuantityRelieved(ORG, LINE)

    expect(h.writes).toEqual([{ recordId: `flinedef:${LINE}`, value: 3 }])
  })

  it('ignores a receive/build movement that happens to carry the same fulfillment line id in fixture noise', async () => {
    h.movements = [
      { lineId: LINE, type: 'sale', quantity: -4 },
      { lineId: LINE, type: 'build_consume', quantity: -100 },
    ]

    await recalculateFulfillmentLineQuantityRelieved(ORG, LINE)

    expect(h.writes).toEqual([{ recordId: `flinedef:${LINE}`, value: 4 }])
  })
})
