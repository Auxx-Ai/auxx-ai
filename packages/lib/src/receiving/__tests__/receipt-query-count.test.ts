// packages/lib/src/receiving/__tests__/receipt-query-count.test.ts
//
// The regression guard for the receipt fan-out.
//
// Writing one `stock_movement` used to fire a chain that re-derived the WHOLE
// purchase order: resolve the parent, read every line, read the order's current
// statuses. `receivePurchaseOrder` loops that chain once per line, so a ten-line
// receipt paid for ten identical order-level derivations — the same query, the
// same answer, nine times over.
//
// 🛑 This file counts SELECTs. Nothing else here will catch the regression: the
// behaviour is identical either way, only the cost changes, so the next hook
// somebody chains onto the roll-up would put the amplifier straight back with
// every assertion still green. The number to defend is the RATIO — a ten-line
// receipt must not cost ten times a one-line receipt.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityTriggerEvent } from '../../field-hooks/types'
import type { MovementRecord, ReceivePurchaseOrderLineInput } from '../types'

const ORG = 'org_1'
const USER = 'user_1'
const PO = 'po_1'

const FIELDS: Record<string, { id: string; type: string }> = {
  purchase_order_line_expected_unit_price: { id: 'fld-price', type: 'NUMBER' },
  stock_movement_quantity: { id: 'fld-mv-qty', type: 'NUMBER' },
  stock_movement_purchase_order_line: { id: 'fld-mv-poline', type: 'RELATIONSHIP' },
  purchase_order_line_purchase_order: { id: 'fld-po-rel', type: 'RELATIONSHIP' },
  purchase_order_line_quantity_ordered: { id: 'fld-ordered', type: 'NUMBER' },
  purchase_order_line_quantity_received: { id: 'fld-received', type: 'NUMBER' },
  purchase_order_line_quantity_billed: { id: 'fld-billed', type: 'NUMBER' },
  purchase_order_status: { id: 'fld-status', type: 'SINGLE_SELECT' },
  purchase_order_receipt_status: { id: 'fld-receipt', type: 'SINGLE_SELECT' },
  purchase_order_billing_status: { id: 'fld-billing', type: 'SINGLE_SELECT' },
}

const h = vi.hoisted(() => ({
  /** Every `.select(...)` on either connection, whoever issued it. */
  selects: 0,
  /** Every `setValueWithType` — the write half of the budget. */
  writes: 0,
  /** The purchase order's lines and what has been received against each. */
  lineIds: [] as string[],
  movementQuantity: new Map<string, number>(),
  storedReceived: new Map<string, number>(),
}))

/**
 * Bound string parameters of a drizzle `sql` node, so a query that names its
 * subject in a JOIN predicate rather than in its projection can still be
 * answered. `StringChunk.value` is an array, `Param.value` is the bound value.
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

/** Chainable drizzle stub. The rows are chosen once the query is awaited. */
function chain(projection: Record<string, unknown>, route: (q: Query) => unknown[]) {
  const query: Query = { projection, params: [] }
  const node: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'limit', 'groupBy']) node[key] = () => node
  for (const key of ['innerJoin', 'leftJoin']) {
    node[key] = (_alias: unknown, condition: unknown) => {
      boundStrings(condition, query.params)
      return node
    }
  }
  node.then = (resolve: (v: unknown) => unknown) => Promise.resolve(route(query)).then(resolve)
  return node
}

interface Query {
  projection: Record<string, unknown>
  params: string[]
}

/** The order's lines as the folded status read returns them. */
function statusRows() {
  return h.lineIds.map((lineId) => ({
    orderId: PO,
    ordered: 10,
    received: h.storedReceived.get(lineId) ?? null,
    billed: null,
    statusOption: 'issued',
    receiptStatusOption: 'not_received',
    billingStatusOption: 'not_billed',
  }))
}

/**
 * Route a query by the keys it projects — the one part of a drizzle call that
 * is plain data. Each branch is named for the function that issues it.
 */
function routeModuleSelect(query: Query): unknown[] {
  const keys = Object.keys(query.projection).sort().join(',')
  switch (keys) {
    // readTotalsByLine — the batched grouped SUM
    case 'lineId,total':
      return h.lineIds
        .filter((lineId) => h.movementQuantity.has(lineId))
        .map((lineId) => ({ lineId, total: String(h.movementQuantity.get(lineId)) }))
    // readStoredTotals — what the lines already hold
    case 'entityId,valueNumber':
      return [...h.storedReceived.entries()].map(([entityId, valueNumber]) => ({
        entityId,
        valueNumber,
      }))
    // readOrdersForLines — the distinct parents behind a set of lines
    case 'relatedEntityId':
      return [{ relatedEntityId: PO }]
    // readOrderStatusInputs — parent, lines and current statuses in one read
    case 'billed,billingStatusOption,orderId,ordered,receiptStatusOption,received,statusOption':
      return statusRows()
    // recalculatePurchaseOrderLineRollup — one line's SUM plus its stored total.
    // The line is named in the join predicate, not the projection.
    case 'current,total': {
      const lineId = query.params.find((param) => h.lineIds.includes(param)) ?? ''
      return [
        {
          total: String(h.movementQuantity.get(lineId) ?? 0),
          current: h.storedReceived.get(lineId) ?? null,
        },
      ]
    }
    default:
      throw new Error(`Unrouted query projecting: ${keys}`)
  }
}

vi.mock('@auxx/database', () => ({
  database: {
    select: (projection: Record<string, unknown>) => {
      h.selects++
      return chain(projection, routeModuleSelect)
    },
  },
  schema: {
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      optionId: 'optionId',
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
  requireCachedEntityDefId: async (_org: string, entityType: string) => `def_${entityType}`,
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: () => ({ organizationId: ORG }),
}))
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: (t: string) => t }))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: vi.fn(
    async (
      _ctx: unknown,
      args: { recordId: string; fieldId: string; value: { value?: number } }
    ) => {
      h.writes++
      if (args.fieldId === FIELDS.purchase_order_line_quantity_received!.id) {
        const lineId = args.recordId.split(':')[1] as string
        h.storedReceived.set(lineId, args.value.value ?? 0)
      }
      return []
    }
  ),
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: async () => undefined,
}))

vi.mock('../receive-stock', async () => {
  const { ok } = await import('neverthrow')
  return {
    receiveStock: vi.fn(
      async (_db, _org, _user, input: ReceivePurchaseOrderLineInput & { quantity: number }) => {
        const lineId = (input as { purchaseOrderLineId: string }).purchaseOrderLineId
        h.movementQuantity.set(lineId, (h.movementQuantity.get(lineId) ?? 0) + input.quantity)
        return ok({
          movementId: `mv_${lineId}`,
          recordId: `def_mv:mv_${lineId}`,
          partInstanceId: input.partId,
          quantity: input.quantity,
          unitCost: 1000,
          extendedCost: 1000 * input.quantity,
          vendorUnitPrice: 1000,
          vendorPartId: null,
          glAccount: '1310',
          occurredAt: new Date(),
          purchaseOrderLineId: lineId,
        } satisfies MovementRecord)
      }
    ),
  }
})

import { recalculatePurchaseOrderLineReceived } from '../../field-hooks/post/purchase-order-line-rollups'
import { receivePurchaseOrder } from '../receive-purchase-order'

/** The caller's connection — `receivePurchaseOrder` reads the agreed prices on it. */
const db = {
  select: (projection: Record<string, unknown>) => {
    h.selects++
    return chain(projection, () => h.lineIds.map((entityId) => ({ entityId, valueNumber: 1000 })))
  },
} as never

/**
 * The per-movement lifecycle rule, as the record-rules engine fires it once the
 * `stock_movement:created` event reaches the worker — one firing per row.
 */
async function fireLifecycleRule(lineId: string) {
  await recalculatePurchaseOrderLineReceived({
    action: 'created',
    entitySlug: 'stock-movements',
    entityType: '',
    entityDefinitionId: 'def_stock_movement',
    entityInstanceId: `mv_${lineId}`,
    organizationId: ORG,
    userId: USER,
    values: { stock_movement_purchase_order_line: lineId },
  } as unknown as EntityTriggerEvent)
}

/** Receive `count` lines of one purchase order, then let every rule fire. */
async function receiveAndSettle(count: number) {
  h.lineIds = Array.from({ length: count }, (_unused, i) => `pol_${i + 1}`)
  h.movementQuantity = new Map()
  h.storedReceived = new Map()
  h.selects = 0
  h.writes = 0

  const result = await receivePurchaseOrder(db, ORG, USER, {
    lines: h.lineIds.map((purchaseOrderLineId, i) => ({
      partId: `part_${i + 1}`,
      purchaseOrderLineId,
      quantity: 4,
    })),
  })
  expect(result.isOk()).toBe(true)

  for (const lineId of h.lineIds) await fireLifecycleRule(lineId)

  return { selects: h.selects, writes: h.writes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the cost of a receipt', () => {
  it('a one-line receipt reads four times and writes once', async () => {
    // 1 agreed price + 1 batched roll-up SUM + 1 order-level derivation, then
    // the movement's own lifecycle rule re-SUMs its line once and finds nothing
    // to do. The write is the line's `quantity_received`; the order's derived
    // statuses were already `not_received`/`not_billed`, so only the receipt
    // axis moves.
    const { selects } = await receiveAndSettle(1)
    expect(selects).toBe(4)
  })

  it('🛑 a ten-line receipt is NOT ten times a one-line receipt', async () => {
    const one = await receiveAndSettle(1)
    const ten = await receiveAndSettle(10)

    expect(ten.selects).toBeLessThan(one.selects * 10)
    // The exact budget, so a regression names itself rather than drifting up to
    // the ceiling above: 1 price read + 2 batched roll-up reads + 2 batched
    // order-level reads + 10 lifecycle re-SUMs that each find their line
    // already settled.
    expect(ten.selects).toBe(15)
  })

  it('derives the ORDER once, however many lines arrived', async () => {
    // The measurement that matters. Nine of the ten order-level passes returned
    // an identical answer, and each cost a parent lookup, a full line read and a
    // status read before it could say so.
    const ten = await receiveAndSettle(10)
    const perLine = (ten.selects - 1) / 10
    expect(perLine).toBeLessThan(2)
  })

  it('leaves every line settled, which is what makes the lifecycle rules cheap', async () => {
    await receiveAndSettle(10)
    for (const lineId of h.lineIds) expect(h.storedReceived.get(lineId)).toBe(4)
  })

  it('writes each line’s quantity exactly once — the rules that follow re-write nothing', async () => {
    const { writes } = await receiveAndSettle(10)
    // 10 line quantities + the order's receipt status. Nothing else moved.
    expect(writes).toBe(11)
  })
})

describe('the fallback is still there', () => {
  it('settles a line from its own lifecycle rule when no batch ran', async () => {
    // A direct `receiveStock`, an adjustment, a reversal: no batch around them.
    // The per-movement rule must still do the whole job.
    h.lineIds = ['pol_1']
    h.movementQuantity = new Map([['pol_1', 7]])
    h.storedReceived = new Map()
    h.selects = 0
    h.writes = 0

    await fireLifecycleRule('pol_1')

    expect(h.storedReceived.get('pol_1')).toBe(7)
    // Its SUM, then the order-level derivation it chains.
    expect(h.selects).toBe(2)
  })

  it('does the whole job twice rather than skipping it, if the batch is forgotten', async () => {
    // The fail-safe direction. Suppression here is idempotence, not a flag:
    // nothing tells the rule to stand down, it just finds the answer already
    // written. Forget the batch and the rule pays full price and is correct.
    h.lineIds = ['pol_1']
    h.movementQuantity = new Map([['pol_1', 7]])
    h.storedReceived = new Map()

    await fireLifecycleRule('pol_1')
    h.selects = 0
    await fireLifecycleRule('pol_1')

    expect(h.selects).toBe(1)
    expect(h.storedReceived.get('pol_1')).toBe(7)
  })
})
