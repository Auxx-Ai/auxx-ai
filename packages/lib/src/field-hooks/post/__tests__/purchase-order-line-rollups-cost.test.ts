// packages/lib/src/field-hooks/post/__tests__/purchase-order-line-rollups-cost.test.ts
//
// The regression guard for the receipt fan-out: a ten-line receipt's roll-up must not cost ten
// times a one-line receipt's. The behaviour is identical either way, only the SELECT count moves,
// so this file counts SELECTs.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const USER = 'user_1'
const PO = 'po_1'

const FIELDS: Record<string, { id: string; type: string }> = {
  purchase_order_line_expected_unit_price: { id: 'fld-price', type: 'NUMBER' },
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
function chain(projection: Record<string, unknown> | undefined, route: (q: Query) => unknown[]) {
  const query: Query = { projection: projection ?? {}, params: [] }
  const node: Record<string, unknown> = {}
  for (const key of ['from', 'limit', 'groupBy', 'orderBy']) node[key] = () => node
  for (const key of ['innerJoin', 'leftJoin', 'where']) {
    node[key] = (...args: unknown[]) => {
      boundStrings(args.at(-1), query.params)
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
    case 'billed,billingStatusOption,orderId,ordered,partKind,receiptStatusOption,received,statusOption':
      return statusRows()
    // recalculatePurchaseOrderLineRollup — one line's SUM plus its stored total.
    // The line is named in the predicate, not the projection.
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
    EntityInstance: {
      id: 'id',
      organizationId: 'organizationId',
      entityDefinitionId: 'entityDefinitionId',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      archivedAt: 'archivedAt',
    },
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      optionId: 'optionId',
      relatedEntityId: 'relatedEntityId',
    },
    CustomField: { id: 'id', systemAttribute: 'systemAttribute' },
    StockMovement: {
      id: 'id',
      organizationId: 'organizationId',
      purchaseOrderLineId: 'purchaseOrderLineId',
      quantity: 'quantity',
    },
  },
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, FIELDS[attr] ?? null])),
    }),
  }),
  getCachedEntityDefId: async (_org: string, entityType: string) => `def_${entityType}`,
  requireCachedEntityDefId: async (_org: string, entityType: string) => `def_${entityType}`,
}))
vi.mock('../../../field-values/field-value-helpers', async (importOriginal) => ({
  // `readSystemRecords` types its cells through the real `rowsToTypedValues`.
  ...(await importOriginal<Record<string, unknown>>()),
  createFieldValueContext: () => ({ organizationId: ORG }),
}))
vi.mock('../../../field-values/stored-field-type', () => ({ toFieldType: (t: string) => t }))
vi.mock('../../../field-values/field-value-mutations', () => ({
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
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: async () => undefined,
}))

import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineRollup,
  recalculatePurchaseOrderLineRollups,
} from '../purchase-order-line-rollups'

/** Receive 4 of each of `count` lines, then settle their roll-up once, as `settleStockMovements` does. */
async function receiveAndSettle(count: number) {
  h.lineIds = Array.from({ length: count }, (_unused, i) => `pol_${i + 1}`)
  h.movementQuantity = new Map(h.lineIds.map((lineId) => [lineId, 4]))
  h.storedReceived = new Map()
  h.selects = 0
  h.writes = 0
  await recalculatePurchaseOrderLineRollups(ORG, h.lineIds, PURCHASE_ORDER_LINE_ROLLUPS.received)
  return { selects: h.selects, writes: h.writes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the cost of a receipt', () => {
  it('a one-line receipt reads twice: its SUM, then the order-level derivation', async () => {
    const { selects } = await receiveAndSettle(1)
    expect(selects).toBe(2)
  })

  it('🛑 a ten-line receipt is NOT ten times a one-line receipt', async () => {
    const one = await receiveAndSettle(1)
    const ten = await receiveAndSettle(10)
    expect(ten.selects).toBeLessThan(one.selects * 10)
    // 2 batched roll-up reads + 2 batched order-level reads.
    expect(ten.selects).toBe(4)
  })

  it('leaves every line settled', async () => {
    await receiveAndSettle(10)
    for (const lineId of h.lineIds) expect(h.storedReceived.get(lineId)).toBe(4)
  })

  it('writes each line’s quantity exactly once, plus the order’s receipt status', async () => {
    const { writes } = await receiveAndSettle(10)
    expect(writes).toBe(11)
  })
})

describe('an already-settled line', () => {
  it('reads once and writes nothing when the stored total matches', async () => {
    h.lineIds = ['pol_1']
    h.movementQuantity = new Map([['pol_1', 7]])
    h.storedReceived = new Map()
    await recalculatePurchaseOrderLineRollup(ORG, 'pol_1', PURCHASE_ORDER_LINE_ROLLUPS.received)
    expect(h.storedReceived.get('pol_1')).toBe(7)

    h.selects = 0
    h.writes = 0
    await recalculatePurchaseOrderLineRollup(ORG, 'pol_1', PURCHASE_ORDER_LINE_ROLLUPS.received)
    expect(h.selects).toBe(1)
    expect(h.writes).toBe(0)
  })
})
