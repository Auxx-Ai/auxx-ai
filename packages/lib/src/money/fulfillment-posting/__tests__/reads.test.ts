// packages/lib/src/money/fulfillment-posting/__tests__/reads.test.ts
//
// The netting read, the running prior-subtotal sum it replaces a SQL window
// function with, and the two shapes it is easy to get silently wrong: a TAGS
// gateway stored as an opaque option key rather than a name, and a
// `line_item_tax_total` that is absent rather than zero.
//
// 🛑 The netting PREDICATE is asserted structurally. The three cases in it are
// the whole netting contract (49 §2.6 rule 1) - a null stamp, a stamp naming a
// posting that is gone, or one naming a `reversed` posting - and a refactor
// that dropped any of them would silently strand a reversed period's
// shipments: they would simply never be offered again.
//
// Entity migration 153 (`plans/money/tasks/55-shipment-lines.md` §6): a
// shipment is a `fulfillment` EntityInstance now, read through
// `money/fulfillments` rather than expanded out of an `order_fulfillments`
// JSON cell - fixtures for it live in `h.fulfillmentsByOrder`, served by the
// mocked `readFulfillmentsForOrders` / `readFulfillmentsForOrder`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  lock: { lockedThroughMonth: null } as { lockedThroughMonth: string | null },
  /** Row sets the stubbed `db.select()` serves, in call order. */
  selects: [] as unknown[][],
  /** How many times `db.select()` was actually invoked. */
  selectCalls: 0,
  /** Every argument every chained query-builder method was handed. */
  captured: [] as unknown[],
  fulfillmentContextMissing: false,
  missingFulfillmentFields: [] as string[],
  orderContextMissing: false,
  /** `orderId -> fulfillment fixtures`, served by the mocked bulk reader. */
  fulfillmentsByOrder: {} as Record<string, unknown[]>,
  // brief 13 §5: per-order tax lines the mocked `readOrderTaxLines` returns.
  taxLinesByOrder: new Map<string, Array<{ title: string; priceMinor: number }>>(),
}))

/** Every `fulfillment` attribute {@link module:reads} resolves through the context. */
const FULFILLMENT_FIELD_IDS = {
  fulfillment_order: 'f_fulfillment_order',
  fulfillment_sequence: 'f_fulfillment_sequence',
  fulfillment_shipped_at: 'f_fulfillment_shipped_at',
  fulfillment_status: 'f_fulfillment_status',
  fulfillment_cancelled_at: 'f_fulfillment_cancelled_at',
  fulfillment_name: 'f_fulfillment_name',
  fulfillment_tracking_number: 'f_fulfillment_tracking_number',
  fulfillment_tracking_company: 'f_fulfillment_tracking_company',
  fulfillment_tracking_url: 'f_fulfillment_tracking_url',
  fulfillment_subtotal: 'f_fulfillment_subtotal',
  fulfillment_total: 'f_fulfillment_total',
  fulfillment_shipping_recognised: 'f_fulfillment_shipping_recognised',
  fulfillment_gl_posting: 'f_fulfillment_gl_posting',
  fulfillment_doc_number: 'f_fulfillment_doc_number',
  fulfillment_recorded_at: 'f_fulfillment_recorded_at',
} as const

const ORDER_FIELD_IDS = {
  order_number: 'f_number',
  order_channel: 'f_channel',
  order_currency: 'f_currency',
  order_subtotal: 'f_subtotal',
  order_tax_total: 'f_tax',
  order_shipping_total: 'f_shipping',
  order_total: 'f_total',
  order_fulfillment_status: 'f_fulfillment_status',
  order_line_items: 'f_line_items',
  order_financial_status: 'f_financial_status',
  order_payment_gateways: 'f_gateways',
  order_contact: 'f_contact',
  line_item_name: 'f_line_name',
  line_item_qty: 'f_line_qty',
  line_item_unit_price: 'f_line_price',
  line_item_tax_total: 'f_line_tax',
  line_item_sort_order: 'f_line_sort',
} as const

vi.mock('../../fulfillments', () => ({
  // The real predicate, not a stub: what counts as a live dispatch is the
  // question this module has to get right, and a mock that always returned true
  // would hide exactly the regression the cancelled-fulfillment test pins.
  isLiveFulfillment: (fulfillment: { status: string }) => fulfillment.status !== 'cancelled',
  loadFulfillmentFieldContext: async () => {
    if (h.fulfillmentContextMissing) return null
    const entries = Object.entries(FULFILLMENT_FIELD_IDS).map(([attribute, id]) => [
      attribute,
      h.missingFulfillmentFields.includes(attribute) ? null : { id },
    ])
    return {
      fulfillmentDefId: 'def_fulfillment',
      fulfillmentLineDefId: 'def_fulfillment_line',
      fulfillment: Object.fromEntries(entries),
      line: {
        fulfillment_line_fulfillment: { id: 'f_fulfillment_line_fulfillment' },
        fulfillment_line_line_item: { id: 'f_fulfillment_line_line_item' },
        fulfillment_line_quantity: { id: 'f_fulfillment_line_quantity' },
        fulfillment_line_quantity_relieved: { id: 'f_fulfillment_line_quantity_relieved' },
      },
    }
  },
  readFulfillmentsForOrders: async (
    _db: unknown,
    params: { organizationId: string; orderIds: readonly string[] }
  ) => {
    const map = new Map<string, unknown[]>()
    for (const orderId of params.orderIds) {
      map.set(orderId, h.fulfillmentsByOrder[orderId] ?? [])
    }
    return map
  },
  readFulfillmentsForOrder: async (_db: unknown, params: { orderId: string }) =>
    h.fulfillmentsByOrder[params.orderId] ?? [],
}))

vi.mock('../../orders/reads', () => ({
  requireOrderFieldContext: async () => {
    if (h.orderContextMissing) throw new Error('order fields are not provisioned')
    const field = (id: string, options?: unknown) => ({ id, options })
    const entries = Object.entries(ORDER_FIELD_IDS).map(([attribute, id]) => [
      attribute,
      field(
        id,
        attribute === 'order_payment_gateways'
          ? { options: [{ value: 'opt_sp', label: 'shopify_payments' }] }
          : undefined
      ),
    ])
    const all = Object.fromEntries(entries)
    return { orderDefId: 'def_order', order: all, line: all }
  },
  // Empty by default (brief 13 §5) - no test in this file is about the
  // jurisdiction split, which `split-tax-by-jurisdiction.test.ts` owns. A
  // test that cares sets `h.taxLinesByOrder`.
  readOrderTaxLines: async () => h.taxLinesByOrder,
}))

vi.mock('../../../postings/post-entry', () => ({ LEDGER_CURRENCY: 'USD' }))
vi.mock('../../../postings/period-lock', () => ({ resolvePeriodLock: async () => h.lock }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key] ?? null,
}))

import type { Database } from '@auxx/database'
import {
  countCloseBlockingShipments,
  countUnpostedShipments,
  listOrderFulfillmentPostings,
  readFulfillmentPostingSettings,
  readUnpostedShipments,
} from '../reads'
import type { FulfillmentPostingExclusionReason, FulfillmentPostingPlan } from '../types'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

/** A drizzle query-builder stub: every chained method records its argument. */
function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'leftJoin']) {
      self[method] = (...args: unknown[]) => {
        h.captured.push(...args)
        return self
      }
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.selects[index++] ?? []).then(resolve, reject)
    return self
  }
  return {
    select: () => {
      h.selectCalls++
      return chain()
    },
  } as unknown as Database
}

/** Everything in a drizzle condition tree that reads as text: chunks, columns, params. */
function conditionText(node: unknown, depth = 0): string {
  if (depth > 24 || node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map((item) => conditionText(item, depth + 1)).join(' ')
  if (typeof node !== 'object') return ''
  const record = node as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['queryChunks', 'value', 'name', 'left', 'right', 'sql']) {
    if (key in record) parts.push(conditionText(record[key], depth + 1))
  }
  return parts.join(' ')
}

/** The netting statement's own `where`, found by the range bound only it carries. */
function nettingWhere(from = '2026-07-01'): string {
  return (
    h.captured
      .map((node) => conditionText(node))
      .find((text) => text.includes(`${from}T00:00:00.000Z`)) ?? ''
  )
}

/** One fixture `fulfillment` record, in the shape `money/fulfillments` reads it. */
function fulfillment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ff_1',
    orderId: 'ord_1',
    sequence: 1,
    shippedAt: '2026-07-06T12:00:00.000Z',
    subtotalMinor: 20_000,
    shippingRecognised: false,
    glPosting: null,
    docNumber: null,
    lines: [{ lineItemId: 'li_1', quantity: 2 }],
    ...overrides,
  }
}

/** One `FieldValue` row, in the columns the read selects. */
function value(
  entityId: string,
  fieldId: string,
  columns: Partial<{
    valueText: string | null
    valueNumber: number | null
    optionId: string | null
    relatedEntityId: string | null
  }> = {}
) {
  return {
    entityId,
    fieldId,
    valueText: null,
    valueNumber: null,
    optionId: null,
    relatedEntityId: null,
    sortKey: 0,
    ...columns,
  }
}

/** A whole order, plus one line, as `FieldValue` rows. */
function orderValues() {
  return [
    value('ord_1', ORDER_FIELD_IDS.order_number, { valueText: '#1001' }),
    value('ord_1', ORDER_FIELD_IDS.order_channel, { optionId: 'dtc' }),
    value('ord_1', ORDER_FIELD_IDS.order_currency, { valueText: 'USD' }),
    value('ord_1', ORDER_FIELD_IDS.order_financial_status, { optionId: 'paid' }),
    value('ord_1', ORDER_FIELD_IDS.order_payment_gateways, { optionId: 'opt_sp' }),
    value('ord_1', ORDER_FIELD_IDS.order_subtotal, { valueNumber: 19_999.999_999_999_996 }),
    value('ord_1', ORDER_FIELD_IDS.order_tax_total, { valueNumber: 800 }),
    value('ord_1', ORDER_FIELD_IDS.order_shipping_total, { valueNumber: 1_500 }),
    value('ord_1', ORDER_FIELD_IDS.order_contact, { relatedEntityId: 'ct_1' }),
    value('li_1', ORDER_FIELD_IDS.line_item_name, { valueText: 'Widget' }),
    value('li_1', ORDER_FIELD_IDS.line_item_qty, { valueNumber: 4 }),
    value('li_1', ORDER_FIELD_IDS.line_item_unit_price, { valueNumber: 5_000 }),
  ]
}

/** Queue the three row sets `readUnpostedShipments` reads, in its own order. */
function queue(
  candidates: Array<{ fulfillmentId: string; orderId: string }>,
  fulfillmentsByOrder: Record<string, unknown[]>
): void {
  h.selects = [
    candidates.map((row) => ({ fulfillmentId: row.fulfillmentId, orderId: row.orderId })),
    orderValues(),
    orderValues(),
  ]
  h.fulfillmentsByOrder = fulfillmentsByOrder
}

const RANGE = { from: '2026-07-01', to: '2026-08-01' }

beforeEach(() => {
  h.settings = {
    'accounting.cutoffPeriod': '2025-12',
    'accounting.bookTimeZone': 'America/Los_Angeles',
  }
  h.lock = { lockedThroughMonth: null }
  h.selects = []
  h.selectCalls = 0
  h.captured = []
  h.fulfillmentContextMissing = false
  h.missingFulfillmentFields = []
  h.orderContextMissing = false
  h.fulfillmentsByOrder = {}
  h.taxLinesByOrder = new Map()
})

describe('the netting read', () => {
  it('nets on a null stamp, a posting that is gone, AND a reversed posting', async () => {
    queue([{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], { ord_1: [fulfillment()] })

    await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    // Two `is null`s - the stamp's own cell and the LEFT JOIN's miss on the
    // posting it names - and one `reversed`.
    expect(nettingWhere().match(/is null/g)).toHaveLength(2)
    expect(nettingWhere()).toContain('reversed')
  })

  it('joins the stamp on the declared field rather than scanning a JSON cell', async () => {
    queue([{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], { ord_1: [fulfillment()] })

    await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    const joins = h.captured.map((node) => conditionText(node)).join(' | ')
    expect(joins).toContain('f_fulfillment_gl_posting')
    expect(joins).toContain('f_fulfillment_order')
  })

  it('keeps the range half-open on the ship day', async () => {
    queue([{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], { ord_1: [fulfillment()] })

    await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(nettingWhere()).toContain('2026-07-01T00:00:00.000Z')
    expect(nettingWhere()).toContain('2026-08-01T00:00:00.000Z')
  })

  it('refuses a range bound that is not a calendar date', async () => {
    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrapErr().message).toMatch(/YYYY-MM-DD/)
  })

  it('reads as no shipments on an org that has not provisioned the fulfillment entities', async () => {
    h.fulfillmentContextMissing = true

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()).toEqual([])
    // Nothing is queried at all - `loadFulfillmentFieldContext` refused first.
    expect(h.selectCalls).toBe(0)
  })

  // An org that has not run entity migration 153's stamp field has stamped
  // nothing, so every candidate IS unposted - one query, not two code paths.
  it('reads every shipment as unposted when the org has no gl-posting field yet', async () => {
    h.missingFulfillmentFields = ['fulfillment_gl_posting']
    queue([{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], { ord_1: [fulfillment()] })

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()).toHaveLength(1)
  })

  it('reads no rows without touching the field reads', async () => {
    h.selects = [[]]

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()).toEqual([])
    // Only the netting query ran - an empty candidate set short-circuits
    // before the order and line pivots.
    expect(h.selectCalls).toBe(1)
  })

  it('drops a shipment whose order fields cannot be read at all', async () => {
    h.selects = [[{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], [], []]
    h.fulfillmentsByOrder = { ord_1: [fulfillment()] }

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()).toEqual([])
  })
})

describe('readUnpostedShipments', () => {
  it('hangs the order and line facts on the shipment, and truncates the instant to a calendar day', async () => {
    queue([{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], { ord_1: [fulfillment()] })

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()).toEqual([
      {
        orderId: 'ord_1',
        orderNumber: '#1001',
        fulfillmentInstanceId: 'ff_1',
        sequence: 1,
        shippedAt: '2026-07-06',
        lines: [
          {
            lineId: 'li_1',
            quantity: 2,
            unitPriceMinor: 5_000,
            lineTaxMinor: null,
            orderedQuantity: 4,
            name: 'Widget',
          },
        ],
        channel: 'dtc',
        currency: 'USD',
        financialStatus: 'paid',
        gateways: ['shopify_payments'],
        // 🛑 Rounded, not refused: `FieldValue.valueNumber` is a double and
        // 20_000 reads back as 19999.999999999996. Refusing here would take a
        // 500-order run down for a rounding artefact.
        orderSubtotalMinor: 20_000,
        orderTaxTotalMinor: 800,
        orderShippingTotalMinor: 1_500,
        priorShipmentsSubtotalMinor: 0,
        includeShipping: false,
        contactId: 'ct_1',
        // Empty: the mocked `readOrderTaxLines` returns nothing (brief 13 §5).
        taxLines: [],
      },
    ])
  })

  // 🔑 The property `priorShipmentsSubtotalMinor` exists for: the sum is over
  // EVERY fulfillment of the order in sequence order, live or not - an earlier
  // shipment that is already posted (and so is NOT itself a candidate here)
  // still has to count, or the tax allocation undercounts on the shipment that
  // completes the order.
  it('NEVER posts a cancelled fulfillment, and an unposted one does not inflate the prior total', async () => {
    // 🛑 The regression this pins. A cancelled dispatch could not exist in the
    // old JSON log - the connector filtered `status !== 'cancelled'` before
    // anything reached it - so nothing downstream ever had to exclude one. It
    // now arrives as a real record on purpose, and posting it would recognise
    // revenue for goods that never went out, silently.
    queue(
      [
        { fulfillmentId: 'ff_cancelled', orderId: 'ord_1' },
        { fulfillmentId: 'ff_live', orderId: 'ord_1' },
      ],
      {
        ord_1: [
          fulfillment({
            id: 'ff_cancelled',
            sequence: 1,
            status: 'cancelled',
            subtotalMinor: 10_000,
            glPosting: null,
          }),
          fulfillment({ id: 'ff_live', sequence: 2, subtotalMinor: 20_000, glPosting: null }),
        ],
      }
    )

    const shipments = (
      await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })
    )._unsafeUnwrap()

    expect(shipments.map((row) => row.fulfillmentInstanceId)).toEqual(['ff_live'])
    // The cancelled one recognised nothing, so it must not count toward what
    // the cumulative tax allocation trues itself up against.
    expect(shipments[0]?.priorShipmentsSubtotalMinor).toBe(0)
  })

  it('DOES count a cancelled fulfillment that was posted before it was cancelled', async () => {
    // The other half of the rule. A reversal never clears the stamp, so a
    // stamped-then-cancelled dispatch did recognise revenue and still belongs
    // in the running total even though it can never be a candidate again.
    queue([{ fulfillmentId: 'ff_live', orderId: 'ord_1' }], {
      ord_1: [
        fulfillment({
          id: 'ff_posted_then_cancelled',
          sequence: 1,
          status: 'cancelled',
          subtotalMinor: 10_000,
          glPosting: 'gl_old',
        }),
        fulfillment({ id: 'ff_live', sequence: 2, subtotalMinor: 20_000, glPosting: null }),
      ],
    })

    const shipments = (
      await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })
    )._unsafeUnwrap()

    expect(shipments.map((row) => row.fulfillmentInstanceId)).toEqual(['ff_live'])
    expect(shipments[0]?.priorShipmentsSubtotalMinor).toBe(10_000)
  })

  it('sums the subtotal of every EARLIER fulfillment of the order, posted or not', async () => {
    h.selects = [[{ fulfillmentId: 'ff_2', orderId: 'ord_1' }], orderValues(), orderValues()]
    h.fulfillmentsByOrder = {
      ord_1: [
        // Sequence 1: already posted (not offered as a candidate), still counts.
        fulfillment({
          id: 'ff_1',
          sequence: 1,
          shippedAt: '2026-07-01T12:00:00.000Z',
          subtotalMinor: 10_000,
          shippingRecognised: true,
          glPosting: 'gl_old',
          lines: [{ lineItemId: 'li_0', quantity: 1 }],
        }),
        fulfillment({
          id: 'ff_2',
          sequence: 2,
          shippedAt: '2026-07-06T12:00:00.000Z',
          subtotalMinor: 20_000,
          shippingRecognised: false,
          lines: [{ lineItemId: 'li_1', quantity: 2 }],
        }),
      ],
    }

    const shipments = (
      await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })
    )._unsafeUnwrap()

    expect(shipments).toHaveLength(1)
    expect(shipments[0]?.fulfillmentInstanceId).toBe('ff_2')
    expect(shipments[0]?.priorShipmentsSubtotalMinor).toBe(10_000)
    // Shipping was recognised on the EARLIER fulfillment, not this one.
    expect(shipments[0]?.includeShipping).toBe(false)
  })

  it('reads every candidate fulfillment of the same order in one pass', async () => {
    h.selects = [
      [
        { fulfillmentId: 'ff_1', orderId: 'ord_1' },
        { fulfillmentId: 'ff_2', orderId: 'ord_1' },
      ],
      orderValues(),
      orderValues(),
    ]
    h.fulfillmentsByOrder = {
      ord_1: [
        fulfillment({ id: 'ff_1', sequence: 1, subtotalMinor: 10_000 }),
        fulfillment({ id: 'ff_2', sequence: 2, subtotalMinor: 20_000 }),
      ],
    }

    const shipments = (
      await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })
    )._unsafeUnwrap()

    // Three queries, whatever the shipment count: the netting join, the order
    // pivot, the line pivot. A fourth would mean a read crept into a loop.
    expect(shipments).toHaveLength(2)
    expect(h.selectCalls).toBe(3)
  })

  // brief 13 §5: the bulk tax-line read is threaded onto the shipment it
  // belongs to, verbatim - the split itself is `splitTaxByJurisdiction`'s job.
  it('carries the order own tax lines onto its shipment', async () => {
    queue([{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], { ord_1: [fulfillment()] })
    h.taxLinesByOrder = new Map([
      [
        'ord_1',
        [
          { title: 'CA State Tax', priceMinor: 600 },
          { title: 'CA District Tax', priceMinor: 200 },
        ],
      ],
    ])

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()[0]?.taxLines).toEqual([
      { title: 'CA State Tax', priceMinor: 600 },
      { title: 'CA District Tax', priceMinor: 200 },
    ])
  })

  // 🛑 A TAGS value is an opaque option KEY, and the debit fork compares gateway
  // NAMES. Reading `optionId` straight through would send every card order to
  // `gateway-ambiguous` or worse, silently.
  it('resolves a gateway option key back to its name', async () => {
    queue([{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], { ord_1: [fulfillment()] })

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()[0]?.gateways).toEqual(['shopify_payments'])
  })

  it('falls back to the stored key when no option matches it', async () => {
    h.selects = [
      [{ fulfillmentId: 'ff_1', orderId: 'ord_1' }],
      [
        ...orderValues(),
        value('ord_1', ORDER_FIELD_IDS.order_payment_gateways, { optionId: 'Affirm' }),
      ],
      orderValues(),
    ]
    h.fulfillmentsByOrder = { ord_1: [fulfillment()] }

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()[0]?.gateways).toEqual(['shopify_payments', 'Affirm'])
  })

  // 🛑 Null is not zero (48 §8.2). A zero here would flip the whole entry onto
  // the per-line tax basis and under-credit sales tax payable.
  it('reads an absent line tax as null and a stored zero as zero', async () => {
    const withTax = [
      ...orderValues(),
      value('li_1', ORDER_FIELD_IDS.line_item_tax_total, { valueNumber: 0 }),
    ]
    h.selects = [[{ fulfillmentId: 'ff_1', orderId: 'ord_1' }], withTax, withTax]
    h.fulfillmentsByOrder = { ord_1: [fulfillment()] }

    const result = await readUnpostedShipments(stubDb(), { organizationId: ORG, range: RANGE })

    expect(result._unsafeUnwrap()[0]?.lines[0]?.lineTaxMinor).toBe(0)
  })
})

describe('countUnpostedShipments', () => {
  it('turns a month into a half-open day range', async () => {
    h.selects = [[]]

    const result = await countUnpostedShipments(stubDb(), { organizationId: ORG, month: '2026-07' })

    expect(result._unsafeUnwrap()).toBe(0)
    expect(nettingWhere('2026-07-01')).toContain('2026-07-01T00:00:00.000Z')
    expect(nettingWhere('2026-07-01')).toContain('2026-08-01T00:00:00.000Z')
  })

  it('rolls December over into the next year', async () => {
    h.selects = [[]]

    await countUnpostedShipments(stubDb(), { organizationId: ORG, month: '2026-12' })

    expect(nettingWhere('2026-12-01')).toContain('2026-12-01T00:00:00.000Z')
    expect(nettingWhere('2026-12-01')).toContain('2027-01-01T00:00:00.000Z')
  })

  it('refuses anything that is not a month', async () => {
    const result = await countUnpostedShipments(stubDb(), {
      organizationId: ORG,
      month: '2026-07-06',
    })

    expect(result._unsafeUnwrapErr().message).toMatch(/YYYY-MM/)
  })
})

describe('countCloseBlockingShipments', () => {
  const exclusion = (reason: FulfillmentPostingExclusionReason) => ({
    orderId: 'o',
    orderNumber: '#1',
    sequence: 1,
    shippedAt: '2026-07-06',
    reason,
    detail: '',
  })
  const plan = (
    shipments: number,
    reasons: FulfillmentPostingExclusionReason[]
  ): FulfillmentPostingPlan => ({
    grouping: 'day',
    groups: [],
    exclusions: reasons.map(exclusion),
    footer: { postings: 0, shipments, orders: 0, excluded: reasons.length, totalMinor: 0 },
  })

  it('counts what would post plus what a person still owes', () => {
    expect(
      countCloseBlockingShipments(
        plan(2, ['foreign-currency', 'gateway-ambiguous', 'test-gateway'])
      )
    ).toBe(5)
  })

  it('lets a zero-value shipment and out-of-range months through', () => {
    expect(
      countCloseBlockingShipments(plan(0, ['zero-value', 'before-cutoff', 'locked-period']))
    ).toBe(0)
  })
})

describe('listOrderFulfillmentPostings', () => {
  it('reports each stamp with the posting status as it stands NOW', async () => {
    h.fulfillmentsByOrder = {
      ord_1: [
        fulfillment({
          id: 'f1',
          sequence: 1,
          shippedAt: '2026-07-06T12:00:00.000Z',
          glPosting: 'gl_1',
        }),
        fulfillment({
          id: 'f2',
          sequence: 2,
          shippedAt: '2026-07-09T12:00:00.000Z',
          glPosting: 'gl_2',
        }),
      ],
    }
    h.selects = [
      [
        { id: 'gl_1', docNumber: 'AUXX-FUL-20260706', status: 'reversed' },
        { id: 'gl_2', docNumber: 'AUXX-FUL-20260709', status: 'posted' },
      ],
    ]

    const result = await listOrderFulfillmentPostings(stubDb(), {
      organizationId: ORG,
      orderId: 'ord_1',
    })

    expect(result._unsafeUnwrap()).toEqual([
      {
        sequence: 1,
        shippedAt: '2026-07-06',
        glPostingId: 'gl_1',
        docNumber: 'AUXX-FUL-20260706',
        status: 'reversed',
      },
      {
        sequence: 2,
        shippedAt: '2026-07-09',
        glPostingId: 'gl_2',
        docNumber: 'AUXX-FUL-20260709',
        status: 'posted',
      },
    ])
  })

  it('ignores an unstamped shipment', async () => {
    h.fulfillmentsByOrder = { ord_1: [fulfillment({ id: 'f1', glPosting: null })] }
    h.selects = [[]]

    expect(
      (
        await listOrderFulfillmentPostings(stubDb(), { organizationId: ORG, orderId: 'ord_1' })
      )._unsafeUnwrap()
    ).toEqual([])
  })

  it('drops a stamp naming a posting that no longer exists', async () => {
    h.fulfillmentsByOrder = { ord_1: [fulfillment({ id: 'f1', glPosting: 'gl_gone' })] }
    h.selects = [[]]

    expect(
      (
        await listOrderFulfillmentPostings(stubDb(), { organizationId: ORG, orderId: 'ord_1' })
      )._unsafeUnwrap()
    ).toEqual([])
  })

  it('returns nothing for an order with no fulfillments at all', async () => {
    h.fulfillmentsByOrder = {}

    expect(
      (
        await listOrderFulfillmentPostings(stubDb(), { organizationId: ORG, orderId: 'ord_1' })
      )._unsafeUnwrap()
    ).toEqual([])
  })
})

describe('readFulfillmentPostingSettings', () => {
  it('reads the cutoff, the lock, the zone and the ledger currency', async () => {
    h.lock = { lockedThroughMonth: '2026-06' }

    const result = await readFulfillmentPostingSettings(stubDb(), ORG)

    expect(result._unsafeUnwrap()).toEqual({
      cutoffPeriod: '2025-12',
      lockedThroughMonth: '2026-06',
      timeZone: 'America/Los_Angeles',
      ledgerCurrency: 'USD',
    })
  })

  // 🛑 Null, never a `'UTC'` default: the run refuses on an unset zone rather
  // than dating revenue into the wrong month invisibly (44 lane 4).
  it('reports an unset or blank book time zone as null', async () => {
    h.settings = { 'accounting.bookTimeZone': '   ' }

    expect((await readFulfillmentPostingSettings(stubDb(), ORG))._unsafeUnwrap()).toMatchObject({
      cutoffPeriod: null,
      timeZone: null,
    })
  })
})
