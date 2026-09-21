// packages/lib/src/accounting/sales/fulfillments/__tests__/stamp-totals.test.ts
//
// `stampOrderShipmentTotals`: the writer synced fulfillments never had
// (plan 78 §1, §4.1). `readOrderForFulfillment` and the field-value write door
// are mocked, the same boundary `vendor-bill-balance.test.ts` draws;
// `computeShipmentTotals` / `shippedLineAmount` / `shapeShipmentLine` /
// `isLiveFulfillment` stay real so the arithmetic itself is exercised.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  fields: {} as Record<string, { id: string; type: string } | null>,
  requireCachedEntityDefId: vi.fn(),
  setValueWithType: vi.fn(),
  publishFieldValueUpdates: vi.fn(),
  systemFieldMap: vi.fn(),
  readOrderForFulfillment: vi.fn(),
}))

vi.mock('../../../../cache', () => ({
  requireCachedEntityDefId: h.requireCachedEntityDefId,
}))
vi.mock('../../../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../../../field-values/field-value-helpers', () => ({
  createFieldValueContext: (organizationId: string) => ({ organizationId }),
}))
vi.mock('../../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))
vi.mock('../../../../resources/system-records', () => ({
  systemFieldMap: h.systemFieldMap,
}))
// The order read is mocked wholesale, the same boundary `fulfill.test.ts` draws:
// this file is about the stamp's own walk and comparisons, not the read's
// mechanics.
vi.mock('../../orders/reads', () => ({
  readOrderForFulfillment: h.readOrderForFulfillment,
}))

import type { Database } from '@auxx/database'
import { stampOrderShipmentTotals } from '../stamp-totals'

const DB = {} as Database
const ORG = 'org_1'
const ORDER = 'ord_1'
const DEF = 'def_fulfillment'

const FIELDS = {
  fulfillment_subtotal: { id: 'f-subtotal', type: 'CURRENCY' },
  fulfillment_total: { id: 'f-total', type: 'CURRENCY' },
  fulfillment_shipping_recognised: { id: 'f-shipping', type: 'CHECKBOX' },
}

/** One order line, in `OrderLineForFulfillment` shape. */
function line(over: Record<string, unknown> = {}) {
  return {
    lineId: 'li_1',
    name: 'Shirt',
    quantity: 3,
    shippedQuantity: 3,
    remainingQuantity: 0,
    unitPriceMinor: 30_00,
    lineTotalMinor: 90_00,
    lineTaxMinor: null,
    sortOrder: 0,
    ...over,
  }
}

/** One `fulfillment` record, unstamped by default (0/0/false - the bug's shape). */
function fulfillment(over: Record<string, unknown> = {}) {
  return {
    id: 'ful_1',
    sequence: 1,
    status: 'success' as string,
    cancelledAt: null,
    subtotalMinor: 0,
    totalMinor: 0,
    shippingRecognised: false,
    glPosting: null as string | null,
    lines: [{ lineItemId: 'li_1', quantity: 2 }],
    ...over,
  }
}

/** Plan §2's order: three shirts at 30, net 90, tax 9, shipping 5. */
function baseOrder(over: Record<string, unknown> = {}) {
  return {
    orderId: ORDER,
    number: 'ORD-0012',
    subtotalMinor: 90_00,
    taxTotalMinor: 9_00,
    shippingTotalMinor: 5_00,
    totalMinor: 104_00,
    shippingOwed: true,
    lines: [line()],
    fulfillments: [
      fulfillment({ id: 'ful_1', sequence: 1, lines: [{ lineItemId: 'li_1', quantity: 2 }] }),
      fulfillment({ id: 'ful_2', sequence: 2, lines: [{ lineItemId: 'li_1', quantity: 1 }] }),
    ],
    ...over,
  }
}

/** Every `setValueWithType` call targeting one fulfillment, keyed by fieldId. */
function writesFor(fulfillmentId: string): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const call of h.setValueWithType.mock.calls) {
    const params = call[1] as { recordId: string; fieldId: string; value: { value: unknown } }
    if (params.recordId === `${DEF}:${fulfillmentId}`) out.set(params.fieldId, params.value.value)
  }
  return out
}

/** Mutate `order.fulfillments` to reflect what was just written - simulates a re-read after commit. */
function applyWrites(order: { fulfillments: Array<Record<string, unknown>> }): void {
  for (const f of order.fulfillments) {
    const written = writesFor(f.id as string)
    if (written.size === 0) continue
    f.subtotalMinor = written.get(FIELDS.fulfillment_subtotal.id)
    f.totalMinor = written.get(FIELDS.fulfillment_total.id)
    f.shippingRecognised = written.get(FIELDS.fulfillment_shipping_recognised.id)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.order = baseOrder()
  h.requireCachedEntityDefId.mockResolvedValue(DEF)
  h.systemFieldMap.mockResolvedValue(FIELDS)
  h.setValueWithType.mockResolvedValue([])
  h.publishFieldValueUpdates.mockResolvedValue(undefined)
  h.readOrderForFulfillment.mockImplementation(async () => {
    const { ok } = await import('neverthrow')
    return ok(h.order)
  })
})

const stamp = () => stampOrderShipmentTotals(DB, ORG, ORDER)

describe('stampOrderShipmentTotals', () => {
  it("stamps plan §2's two shipments: 60/6/5 -> 71, then 30/3/0 -> 33, remainder on the last", async () => {
    const result = await stamp()

    expect(result).toEqual({ fulfillmentsWritten: 2, skippedPosted: 0 })
    const first = writesFor('ful_1')
    expect(first.get(FIELDS.fulfillment_subtotal.id)).toBe(60_00)
    expect(first.get(FIELDS.fulfillment_total.id)).toBe(71_00)
    expect(first.get(FIELDS.fulfillment_shipping_recognised.id)).toBe(true)

    const second = writesFor('ful_2')
    expect(second.get(FIELDS.fulfillment_subtotal.id)).toBe(30_00)
    expect(second.get(FIELDS.fulfillment_total.id)).toBe(33_00)
    expect(second.get(FIELDS.fulfillment_shipping_recognised.id)).toBe(false)
  })

  it('excludes a cancelled first shipment from the prior; the second takes shipping', async () => {
    const order = h.order as ReturnType<typeof baseOrder>
    order.fulfillments[0]!.status = 'cancelled'

    const result = await stamp()

    expect(result).toEqual({ fulfillmentsWritten: 2, skippedPosted: 0 })
    // 78 §7.1 option (a): cancelled still stamps its subtotal, tax and shipping at 0.
    const cancelled = writesFor('ful_1')
    expect(cancelled.get(FIELDS.fulfillment_subtotal.id)).toBe(60_00)
    expect(cancelled.get(FIELDS.fulfillment_total.id)).toBe(60_00)
    expect(cancelled.get(FIELDS.fulfillment_shipping_recognised.id)).toBe(false)

    // The cancelled shipment never entered the prior, so the second is the
    // FIRST live shipment: it takes the shipping the cancelled one never took.
    const second = writesFor('ful_2')
    expect(second.get(FIELDS.fulfillment_subtotal.id)).toBe(30_00)
    expect(second.get(FIELDS.fulfillment_total.id)).toBe(38_00)
    expect(second.get(FIELDS.fulfillment_shipping_recognised.id)).toBe(true)
  })

  it('leaves a posted shipment alone when the recompute disagrees, and counts it', async () => {
    const order = h.order as ReturnType<typeof baseOrder>
    order.fulfillments[0]!.glPosting = 'glp_1' // stored 0/0/false disagrees with the recompute

    const result = await stamp()

    expect(result).toEqual({ fulfillmentsWritten: 1, skippedPosted: 1 })
    expect(writesFor('ful_1').size).toBe(0)
    expect(writesFor('ful_2').size).toBeGreaterThan(0)
  })

  it('uses the per-line basis when every shipped line carries its own tax', async () => {
    h.order = baseOrder({
      shippingOwed: false,
      taxTotalMinor: 300, // deliberately NOT 80 + 120, so allocated and per-line would disagree
      lines: [
        line({ lineId: 'li_a', name: 'A', quantity: 1, lineTotalMinor: 1000, lineTaxMinor: 80 }),
        line({ lineId: 'li_b', name: 'B', quantity: 1, lineTotalMinor: 1000, lineTaxMinor: 120 }),
      ],
      fulfillments: [
        fulfillment({
          id: 'ful_1',
          sequence: 1,
          lines: [
            { lineItemId: 'li_a', quantity: 1 },
            { lineItemId: 'li_b', quantity: 1 },
          ],
        }),
      ],
    })

    const result = await stamp()

    expect(result).toEqual({ fulfillmentsWritten: 1, skippedPosted: 0 })
    const written = writesFor('ful_1')
    expect(written.get(FIELDS.fulfillment_subtotal.id)).toBe(2000)
    // Per-line tax (80 + 120 = 200), not the allocated 300 the order total would give.
    expect(written.get(FIELDS.fulfillment_total.id)).toBe(2200)
  })

  it('writes nothing on a second run once the stored totals already agree', async () => {
    const first = await stamp()
    expect(first.fulfillmentsWritten).toBe(2)

    applyWrites(h.order as ReturnType<typeof baseOrder>)
    h.setValueWithType.mockClear()
    h.publishFieldValueUpdates.mockClear()

    const second = await stamp()

    expect(second).toEqual({ fulfillmentsWritten: 0, skippedPosted: 0 })
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })
})
