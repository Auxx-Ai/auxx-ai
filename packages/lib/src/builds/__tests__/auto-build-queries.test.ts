// packages/lib/src/builds/__tests__/auto-build-queries.test.ts
//
// The reads behind the order-triggered build (§5.3 steps 1-2, 4). The org cache
// is a double and `db` is a stand-in that routes by TABLE IDENTITY plus whether
// the query joined — the same style as `build-event.test.ts`.
//
// ⚠️ `src/test/setup.ts` mocks `@auxx/database` wholesale, so `schema.Foo` is a
// memoized `{}` whose COLUMNS are `undefined`: table identity is comparable by
// reference, but the double cannot read a `WHERE`. The two unjoined
// `FieldValue` reads are therefore told apart by ORDER — order values first,
// line values second — which is exactly the order `loadAutoBuildOrders` issues
// them in.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const ORDER = 'ord_1'
const LINE_A = 'line_a'
const LINE_B = 'line_b'
const LINE_C = 'line_c'
const LIFT = 'part_lift'
const PLACED_FIELD = 'fld_order_placed_at'
const CANCELLED_FIELD = 'fld_order_cancelled_at'
const LINE_ORDER_FIELD = 'fld_line_item_order'
const LINE_PART_FIELD = 'fld_line_item_part'
const LINE_QTY_FIELD = 'fld_line_item_qty'
const QOH_FIELD = 'fld_part_quantity_on_hand'
const CREATED_AT = new Date('2026-08-20T00:00:00.000Z')

const h = vi.hoisted(() => ({
  defs: new Map<string, string>(),
  /** systemAttributes the org has materialised, mapped to a field row id. */
  fields: new Map<string, string>(),
  instanceRows: [] as { id: string; createdAt: Date }[],
  /** `.from(FieldValue)` with NO join, in issue order. */
  valueReads: [] as Record<string, unknown>[][],
  /** `.from(FieldValue).innerJoin(EntityInstance)` — the line -> order edge. */
  joinedRows: [] as Record<string, unknown>[],
  valueReadIndex: 0,
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((attr) => {
            const id = h.fields.get(attr)
            return [attr, id ? { id } : null]
          })
        ),
    }),
  }),
}))

import { loadAutoBuildOrders, readPartQuantitiesOnHand } from '../auto-build-queries'

/** A promise carrying the chain methods, so `await` works anywhere along it. */
function chain(rows: unknown[]): PromiseLike<unknown[]> & { where: () => unknown } {
  const promise = Promise.resolve(rows) as unknown as PromiseLike<unknown[]> & {
    where: () => unknown
  }
  promise.where = () => promise
  return promise
}

const db = {
  select: () => ({
    from: (table: unknown) => {
      if (table === schema.EntityInstance) return chain(h.instanceRows)
      const joined = {
        innerJoin: () => chain(h.joinedRows),
        where: () => {
          const rows = h.valueReads[h.valueReadIndex] ?? []
          h.valueReadIndex += 1
          return Promise.resolve(rows)
        },
      }
      return joined
    },
  }),
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.defs = new Map([
    ['order', 'def_orders'],
    ['line_item', 'def_lines'],
  ])
  h.fields = new Map([
    ['order_placed_at', PLACED_FIELD],
    ['order_cancelled_at', CANCELLED_FIELD],
    ['line_item_order', LINE_ORDER_FIELD],
    ['line_item_part', LINE_PART_FIELD],
    ['line_item_qty', LINE_QTY_FIELD],
    ['part_quantity_on_hand', QOH_FIELD],
  ])
  h.instanceRows = [{ id: ORDER, createdAt: CREATED_AT }]
  h.valueReads = [[], []]
  h.joinedRows = []
  h.valueReadIndex = 0
})

describe('loadAutoBuildOrders', () => {
  it('returns the order with its placed date and its lines', async () => {
    h.valueReads = [
      [{ entityId: ORDER, fieldId: PLACED_FIELD, valueDate: '2026-08-27T09:00:00.000Z' }],
      [
        { entityId: LINE_A, fieldId: LINE_PART_FIELD, relatedEntityId: LIFT, valueNumber: null },
        { entityId: LINE_A, fieldId: LINE_QTY_FIELD, relatedEntityId: null, valueNumber: 2 },
      ],
    ]
    h.joinedRows = [{ lineId: LINE_A, orderId: ORDER }]

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order).toEqual({
      orderId: ORDER,
      placedAt: new Date('2026-08-27T09:00:00.000Z'),
      cancelledAt: null,
      lines: [{ partId: LIFT, quantity: 2 }],
    })
  })

  it('falls back to the row createdAt when the order carries no placed date', async () => {
    h.joinedRows = []

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.placedAt).toEqual(CREATED_AT)
  })

  it('surfaces `order_cancelled_at`', async () => {
    h.valueReads = [
      [{ entityId: ORDER, fieldId: CANCELLED_FIELD, valueDate: '2026-08-28T00:00:00.000Z' }],
      [],
    ]

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.cancelledAt).toEqual(new Date('2026-08-28T00:00:00.000Z'))
  })

  it('drops a line that reaches no part — §5.3 step 2', async () => {
    h.valueReads = [
      [],
      [
        { entityId: LINE_A, fieldId: LINE_PART_FIELD, relatedEntityId: LIFT, valueNumber: null },
        { entityId: LINE_A, fieldId: LINE_QTY_FIELD, relatedEntityId: null, valueNumber: 1 },
        // LINE_B carries a quantity but no `line_item_part`.
        { entityId: LINE_B, fieldId: LINE_QTY_FIELD, relatedEntityId: null, valueNumber: 9 },
      ],
    ]
    h.joinedRows = [
      { lineId: LINE_A, orderId: ORDER },
      { lineId: LINE_B, orderId: ORDER },
    ]

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.lines).toEqual([{ partId: LIFT, quantity: 1 }])
  })

  it('keeps two lines of the SAME part separate — the summing happens later', async () => {
    // Collapsing here would hide the case `sumQuantityByPart` exists to handle.
    h.valueReads = [
      [],
      [
        { entityId: LINE_A, fieldId: LINE_PART_FIELD, relatedEntityId: LIFT, valueNumber: null },
        { entityId: LINE_A, fieldId: LINE_QTY_FIELD, relatedEntityId: null, valueNumber: 2 },
        { entityId: LINE_C, fieldId: LINE_PART_FIELD, relatedEntityId: LIFT, valueNumber: null },
        { entityId: LINE_C, fieldId: LINE_QTY_FIELD, relatedEntityId: null, valueNumber: 3 },
      ],
    ]
    h.joinedRows = [
      { lineId: LINE_A, orderId: ORDER },
      { lineId: LINE_C, orderId: ORDER },
    ]

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.lines).toEqual([
      { partId: LIFT, quantity: 2 },
      { partId: LIFT, quantity: 3 },
    ])
  })

  it('reads a line with no stored quantity as zero, so the policy drops it', async () => {
    h.valueReads = [
      [],
      [{ entityId: LINE_A, fieldId: LINE_PART_FIELD, relatedEntityId: LIFT, valueNumber: null }],
    ]
    h.joinedRows = [{ lineId: LINE_A, orderId: ORDER }]

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.lines).toEqual([{ partId: LIFT, quantity: 0 }])
  })

  it('returns nothing at all for an empty input, without touching the cache', async () => {
    const cache = await import('../../cache')
    expect(await loadAutoBuildOrders(db, ORG, [])).toEqual([])
    expect(cache.getCachedEntityDefId).not.toHaveBeenCalled()
  })

  it('returns nothing for an org with no `order` def', async () => {
    h.defs.delete('order')
    expect(await loadAutoBuildOrders(db, ORG, [ORDER])).toEqual([])
  })

  it('returns nothing for an org missing `line_item_part`', async () => {
    // Nothing can reach a part, so there is nothing to build from — an empty
    // list rather than a logged failure on every order create.
    h.fields.delete('line_item_part')
    expect(await loadAutoBuildOrders(db, ORG, [ORDER])).toEqual([])
  })

  it('returns nothing when the order id resolves to no live row', async () => {
    h.instanceRows = []
    expect(await loadAutoBuildOrders(db, ORG, [ORDER])).toEqual([])
  })
})

describe('readPartQuantitiesOnHand', () => {
  it('reads a stored quantity and defaults an uncounted part to zero', async () => {
    h.valueReads = [[{ entityId: LIFT, valueNumber: 7 }]]

    const quantities = await readPartQuantitiesOnHand(db, ORG, [LIFT, 'part_never_counted'])

    expect(quantities.get(LIFT)).toBe(7)
    expect(quantities.get('part_never_counted')).toBe(0)
  })

  it('defaults every part to zero when the org has no `part_quantity_on_hand`', async () => {
    h.fields.delete('part_quantity_on_hand')

    const quantities = await readPartQuantitiesOnHand(db, ORG, [LIFT])

    expect(quantities.get(LIFT)).toBe(0)
  })

  it('is empty for an empty input', async () => {
    expect((await readPartQuantitiesOnHand(db, ORG, [])).size).toBe(0)
  })
})
