// packages/lib/src/inventory/builds/__tests__/auto-build-queries.test.ts
//
// The reads behind the order-triggered build (§5.3 steps 1-2, 4). The org cache
// is a double and `db` is a stand-in that routes by TABLE IDENTITY plus whether
// the select PROJECTED columns — which is how `readSystemRecords`'s two
// `FieldValue` shapes are told apart (a `{ entityId }` projection is the
// child-by-parent lookup; the cell read takes whole rows).
//
// ⚠️ `src/test/setup.ts` mocks `@auxx/database` wholesale, so `schema.Foo` is a
// memoized `{}` whose COLUMNS are `undefined`: table identity is comparable by
// reference, but the double cannot read a `WHERE`. Every queue is therefore
// FIFO and query ORDER is load-bearing — orders, then the line edge, then the
// line instances, then the line cells.

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
  /** systemAttributes the org has materialised, mapped to the field's id and type. */
  fields: new Map<string, { id: string; type: string }>(),
  /** `.from(EntityInstance)`, FIFO: the orders page, then the lines page. */
  instanceReads: [] as { id: string; createdAt: Date }[][],
  /** `.from(FieldValue)` with a PROJECTION — the child-by-parent edge, and the QoH read. */
  projectedReads: [] as Record<string, unknown>[][],
  /** `.from(FieldValue)` with no projection — the cell reads, in issue order. */
  valueReads: [] as Record<string, unknown>[][],
  instanceIndex: 0,
  projectedIndex: 0,
  valueIndex: 0,
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, h.fields.get(attr) ?? null])),
    }),
  }),
}))

import { loadAutoBuildOrders, readPartQuantitiesOnHand } from '../auto-build-queries'

/** A promise carrying the chain methods, so `await` works anywhere along it. */
function chain(rows: unknown[]) {
  const promise = Promise.resolve(rows)
  return Object.assign(promise, { orderBy: () => promise })
}

function next(queue: unknown[][], index: 'instanceIndex' | 'projectedIndex' | 'valueIndex') {
  const rows = queue[h[index]] ?? []
  h[index] += 1
  return rows
}

const db = {
  select: (columns?: unknown) => ({
    from: (table: unknown) => {
      const builder = {
        $dynamic: () => builder,
        innerJoin: () => builder,
        where: () => {
          // `findSystemRecordIdsByValue` is the only read that projects a `key`
          // beside the instance id; it is the child-by-parent lookup here.
          const keyed = !!columns && typeof columns === 'object' && 'key' in columns
          if (keyed) return chain(next(h.projectedReads, 'projectedIndex'))
          if (table === schema.EntityInstance) return chain(next(h.instanceReads, 'instanceIndex'))
          if (columns) return chain(next(h.projectedReads, 'projectedIndex'))
          return chain(next(h.valueReads, 'valueIndex'))
        },
      }
      return builder
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
    ['order_placed_at', { id: PLACED_FIELD, type: 'DATE' }],
    ['order_cancelled_at', { id: CANCELLED_FIELD, type: 'DATE' }],
    ['line_item_order', { id: LINE_ORDER_FIELD, type: 'RELATIONSHIP' }],
    ['line_item_part', { id: LINE_PART_FIELD, type: 'RELATIONSHIP' }],
    ['line_item_qty', { id: LINE_QTY_FIELD, type: 'NUMBER' }],
    ['part_quantity_on_hand', { id: QOH_FIELD, type: 'NUMBER' }],
  ])
  h.instanceReads = [[{ id: ORDER, createdAt: CREATED_AT }], []]
  h.projectedReads = [[]]
  h.valueReads = [[], []]
  h.instanceIndex = 0
  h.projectedIndex = 0
  h.valueIndex = 0
})

/** The line's own cells: its order edge, its part, its quantity. */
function lineValues(lineId: string, partId: string | null, quantity: number | null) {
  const rows: Record<string, unknown>[] = [
    {
      entityId: lineId,
      fieldId: LINE_ORDER_FIELD,
      relatedEntityId: ORDER,
      relatedEntityDefinitionId: 'def_orders',
    },
  ]
  if (partId) {
    rows.push({
      entityId: lineId,
      fieldId: LINE_PART_FIELD,
      relatedEntityId: partId,
      relatedEntityDefinitionId: 'def_parts',
    })
  }
  if (quantity != null) {
    rows.push({ entityId: lineId, fieldId: LINE_QTY_FIELD, valueNumber: quantity })
  }
  return rows
}

/** Queue the three reads `readSystemRecords(..., { by })` issues for a set of lines. */
function queueLines(lines: { id: string; partId: string | null; quantity: number | null }[]) {
  h.projectedReads = [lines.map((line) => ({ entityId: line.id, key: 'ord_1' }))]
  h.instanceReads[1] = lines.map((line) => ({ id: line.id, createdAt: CREATED_AT }))
  h.valueReads[1] = lines.flatMap((line) => lineValues(line.id, line.partId, line.quantity))
}

describe('loadAutoBuildOrders', () => {
  it('returns the order with its placed date and its lines', async () => {
    h.valueReads[0] = [
      { entityId: ORDER, fieldId: PLACED_FIELD, valueDate: '2026-08-27T09:00:00.000Z' },
    ]
    queueLines([{ id: LINE_A, partId: LIFT, quantity: 2 }])

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order).toEqual({
      orderId: ORDER,
      placedAt: new Date('2026-08-27T09:00:00.000Z'),
      cancelledAt: null,
      lines: [{ partId: LIFT, quantity: 2 }],
    })
  })

  it('falls back to the row createdAt when the order carries no placed date', async () => {
    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.placedAt).toEqual(CREATED_AT)
  })

  it('surfaces `order_cancelled_at`', async () => {
    h.valueReads[0] = [
      { entityId: ORDER, fieldId: CANCELLED_FIELD, valueDate: '2026-08-28T00:00:00.000Z' },
    ]

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.cancelledAt).toEqual(new Date('2026-08-28T00:00:00.000Z'))
  })

  it('drops a line that reaches no part — §5.3 step 2', async () => {
    queueLines([
      { id: LINE_A, partId: LIFT, quantity: 1 },
      // LINE_B carries a quantity but no `line_item_part`.
      { id: LINE_B, partId: null, quantity: 9 },
    ])

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.lines).toEqual([{ partId: LIFT, quantity: 1 }])
  })

  it('keeps two lines of the SAME part separate — the summing happens later', async () => {
    // Collapsing here would hide the case `sumQuantityByPart` exists to handle.
    queueLines([
      { id: LINE_A, partId: LIFT, quantity: 2 },
      { id: LINE_C, partId: LIFT, quantity: 3 },
    ])

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.lines).toEqual([
      { partId: LIFT, quantity: 2 },
      { partId: LIFT, quantity: 3 },
    ])
  })

  it('reads a line with no stored quantity as zero, so the policy drops it', async () => {
    queueLines([{ id: LINE_A, partId: LIFT, quantity: null }])

    const [order] = await loadAutoBuildOrders(db, ORG, [ORDER])

    expect(order?.lines).toEqual([{ partId: LIFT, quantity: 0 }])
  })

  it('returns nothing at all for an empty input, without touching the cache', async () => {
    const cache = await import('../../../cache')
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
    h.instanceReads[0] = []
    expect(await loadAutoBuildOrders(db, ORG, [ORDER])).toEqual([])
  })
})

describe('readPartQuantitiesOnHand', () => {
  it('reads a stored quantity and defaults an uncounted part to zero', async () => {
    h.projectedReads = [[{ entityId: LIFT, valueNumber: 7 }]]

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
