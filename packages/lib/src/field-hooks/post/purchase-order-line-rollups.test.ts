// packages/lib/src/field-hooks/post/purchase-order-line-rollups.test.ts
//
// `purchase_order_line_quantity_received` / `_quantity_billed` are declared
// `creatable: false, updatable: false, computed: true` — unwritable by a human by
// construction — so if this module is not their writer they are NULL forever. That
// is exactly what shipped for `order_number` in #1911, and the shape of the failure
// is silent in both cases.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityTriggerEvent } from '../types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  setValueWithType: vi.fn(),
  createFieldValueContext: vi.fn(),
  requireCachedEntityDefId: vi.fn(),
  publishFieldValueUpdates: vi.fn(),
  // The two shapes the module asks the db for, in call order.
  dbResults: [] as unknown[][],
}))

/** Chainable drizzle stub — resolves to the next queued result set. */
function makeChain() {
  const result = h.dbResults.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'limit']) {
    chain[key] = () => chain
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

vi.mock('@auxx/database', () => ({
  database: { select: () => makeChain() },
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
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  requireCachedEntityDefId: h.requireCachedEntityDefId,
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: () => 'NUMBER' }))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))

import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineBilled,
  recalculatePurchaseOrderLineReceived,
  recalculatePurchaseOrderLineRollup,
} from './purchase-order-line-rollups'

const PO_LINE = 'poline-1'

function event(
  values: Record<string, unknown>,
  overrides: Partial<EntityTriggerEvent> = {}
): EntityTriggerEvent {
  return {
    action: 'created',
    entitySlug: 'stock-movements',
    entityType: '',
    entityDefinitionId: 'smdef',
    entityInstanceId: 'sm-1',
    organizationId: 'org_1',
    userId: 'usr_1',
    values,
    ...overrides,
  } as unknown as EntityTriggerEvent
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbResults = []
  h.bySystemAttributes.mockResolvedValue({
    stock_movement_quantity: { id: 'fld-qty', type: 'NUMBER' },
    stock_movement_purchase_order_line: { id: 'fld-poline', type: 'RELATIONSHIP' },
    purchase_order_line_quantity_received: { id: 'fld-received', type: 'NUMBER' },
    vendor_bill_line_quantity_billed: { id: 'fld-billed-qty', type: 'NUMBER' },
    vendor_bill_line_purchase_order_line: { id: 'fld-bl-poline', type: 'RELATIONSHIP' },
    purchase_order_line_quantity_billed: { id: 'fld-billed', type: 'NUMBER' },
  })
  h.createFieldValueContext.mockReturnValue({ organizationId: 'org_1' })
  h.requireCachedEntityDefId.mockResolvedValue('poldef')
  h.setValueWithType.mockResolvedValue([])
  h.publishFieldValueUpdates.mockResolvedValue(undefined)
})

describe('recalculatePurchaseOrderLineReceived', () => {
  it('re-SUMs the movements and writes the whole total, never an increment', async () => {
    h.dbResults.push([{ total: '17' }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE })
    )

    expect(h.setValueWithType).toHaveBeenCalledWith(
      { organizationId: 'org_1' },
      expect.objectContaining({
        recordId: `poldef:${PO_LINE}`,
        fieldId: 'fld-received',
        value: { type: 'number', value: 17 },
      })
    )
  })

  it('accepts a RecordId-shaped relationship value as well as a bare instance id', async () => {
    h.dbResults.push([{ total: '4' }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: `poldef:${PO_LINE}` })
    )

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recordId: `poldef:${PO_LINE}`,
        value: { type: 'number', value: 4 },
      })
    )
  })

  it('falls back to the movement’s own field value when the event carried none', async () => {
    h.dbResults.push([{ relatedEntityId: PO_LINE }]) // the fallback lookup
    h.dbResults.push([{ total: '9' }]) // the SUM

    await recalculatePurchaseOrderLineReceived(event({}))

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fieldId: 'fld-received', value: { type: 'number', value: 9 } })
    )
  })

  it('is a silent no-op for a movement with no purchase order line', async () => {
    h.dbResults.push([]) // fallback lookup finds nothing

    await recalculatePurchaseOrderLineReceived(event({}))

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('writes 0 rather than skipping when the last movement is deleted', async () => {
    h.dbResults.push([{ total: '0' }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE }, { action: 'deleted' })
    )

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: { type: 'number', value: 0 } })
    )
  })
})

describe('recalculatePurchaseOrderLineBilled', () => {
  it('sums the bill lines into the billed field, not the received one', async () => {
    h.dbResults.push([{ total: '6' }])

    await recalculatePurchaseOrderLineBilled(
      event(
        { vendor_bill_line_purchase_order_line: PO_LINE },
        { entitySlug: 'vendor-bill-lines', entityInstanceId: 'vbl-1' }
      )
    )

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fieldId: 'fld-billed', value: { type: 'number', value: 6 } })
    )
  })
})

describe('the roll-up specs', () => {
  it('name the child quantity field, never the PO line’s own', () => {
    expect(PURCHASE_ORDER_LINE_ROLLUPS.received).toEqual({
      childEntityType: 'stock_movement',
      quantityAttr: 'stock_movement_quantity',
      lineRelAttr: 'stock_movement_purchase_order_line',
      targetAttr: 'purchase_order_line_quantity_received',
    })
    expect(PURCHASE_ORDER_LINE_ROLLUPS.billed).toEqual({
      childEntityType: 'vendor_bill_line',
      quantityAttr: 'vendor_bill_line_quantity_billed',
      lineRelAttr: 'vendor_bill_line_purchase_order_line',
      targetAttr: 'purchase_order_line_quantity_billed',
    })
  })

  it('writes nothing when the org lacks one of the three fields', async () => {
    h.bySystemAttributes.mockResolvedValue({})

    await recalculatePurchaseOrderLineRollup('org_1', PO_LINE, PURCHASE_ORDER_LINE_ROLLUPS.received)

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})
