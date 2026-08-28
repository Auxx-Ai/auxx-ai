// packages/lib/src/field-hooks/post/purchase-order-line-rollups.test.ts
//
// `purchase_order_line_quantity_received` / `_quantity_billed` are declared
// `creatable: false, updatable: false, computed: true` — unwritable by a human by
// construction — so if this module is not their writer they are NULL forever. That
// is exactly what shipped for `order_number` in #1911, and the shape of the failure
// is silent in both cases.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuxxError } from '../../errors'
import type { EntityTriggerEvent } from '../types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  setValueWithType: vi.fn(),
  createFieldValueContext: vi.fn(),
  requireCachedEntityDefId: vi.fn(),
  publishFieldValueUpdates: vi.fn(),
  recalculatePurchaseOrderStatuses: vi.fn(),
  recalculatePurchaseOrderStatusesForLines: vi.fn(),
  // The two shapes the module asks the db for, in call order.
  dbResults: [] as unknown[][],
}))

/** Chainable drizzle stub — resolves to the next queued result set. */
function makeChain() {
  const result = h.dbResults.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'groupBy']) {
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
vi.mock('../../purchasing/purchase-order-status-writer', () => ({
  recalculatePurchaseOrderStatuses: h.recalculatePurchaseOrderStatuses,
  recalculatePurchaseOrderStatusesForLines: h.recalculatePurchaseOrderStatusesForLines,
}))

import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineBilled,
  recalculatePurchaseOrderLineReceived,
  recalculatePurchaseOrderLineRollup,
  recalculatePurchaseOrderLineRollups,
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
  h.recalculatePurchaseOrderStatuses.mockResolvedValue(ok({}))
  h.recalculatePurchaseOrderStatusesForLines.mockResolvedValue(ok([]))
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
      evidence: 'receipt',
    })
    expect(PURCHASE_ORDER_LINE_ROLLUPS.billed).toEqual({
      childEntityType: 'vendor_bill_line',
      quantityAttr: 'vendor_bill_line_quantity_billed',
      lineRelAttr: 'vendor_bill_line_purchase_order_line',
      targetAttr: 'purchase_order_line_quantity_billed',
      evidence: 'billing',
    })
  })

  it('writes nothing when the org lacks one of the three fields', async () => {
    h.bySystemAttributes.mockResolvedValue({})

    await recalculatePurchaseOrderLineRollup('org_1', PO_LINE, PURCHASE_ORDER_LINE_ROLLUPS.received)

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('the order-level status pass', () => {
  it('runs after a receipt roll-up, and declares the evidence as a receipt', async () => {
    h.dbResults.push([{ total: '3' }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE })
    )

    expect(h.recalculatePurchaseOrderStatuses).toHaveBeenCalledWith({
      organizationId: 'org_1',
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })
  })

  it('declares BILLING evidence for a bill line — a bill must never pull an order forward', async () => {
    h.dbResults.push([{ total: '3' }])

    await recalculatePurchaseOrderLineBilled(
      event(
        { vendor_bill_line_purchase_order_line: PO_LINE },
        { entitySlug: 'vendor-bill-lines', entityInstanceId: 'vbl-1' }
      )
    )

    expect(h.recalculatePurchaseOrderStatuses).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: 'billing' })
    )
  })

  it('runs only AFTER the line quantity has been written', async () => {
    const callOrder: string[] = []
    h.setValueWithType.mockImplementation(async () => {
      callOrder.push('line-write')
      return []
    })
    h.recalculatePurchaseOrderStatuses.mockImplementation(async () => {
      callOrder.push('status-pass')
      return ok({})
    })
    h.dbResults.push([{ total: '3' }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE })
    )

    expect(callOrder).toEqual(['line-write', 'status-pass'])
  })

  it('does not run when no purchase order line could be resolved', async () => {
    h.dbResults.push([])

    await recalculatePurchaseOrderLineReceived(event({}))

    expect(h.recalculatePurchaseOrderStatuses).not.toHaveBeenCalled()
  })

  it('swallows a status failure — the quantity is committed and must not be taken down with it', async () => {
    h.dbResults.push([{ total: '3' }])
    h.recalculatePurchaseOrderStatuses.mockResolvedValue(err(new AuxxError('boom')))

    await expect(
      recalculatePurchaseOrderLineReceived(event({ stock_movement_purchase_order_line: PO_LINE }))
    ).resolves.toBeUndefined()

    expect(h.setValueWithType).toHaveBeenCalled()
  })
})

describe('the stored total is read in the same statement as the SUM', () => {
  it('writes nothing and derives nothing when the line already holds the total', async () => {
    // The second short-circuit. Writing the same number back is not free: it
    // fires the field-hook chain, a realtime publish, and the whole order-level
    // derivation behind it.
    h.dbResults.push([{ total: '17', current: 17 }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE })
    )

    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
    expect(h.recalculatePurchaseOrderStatuses).not.toHaveBeenCalled()
  })

  it('🛑 writes when the stored total could not be read — never the other way round', async () => {
    // Fail SAFE. An unreadable stored total falls through to the write the old
    // unconditional path always did. The opposite bias would leave a purchase
    // order holding a stale quantity with nothing thrown.
    h.dbResults.push([{ total: '17', current: null }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE })
    )

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: { type: 'number', value: 17 } })
    )
    expect(h.recalculatePurchaseOrderStatuses).toHaveBeenCalled()
  })

  it('writes when a stored total of zero differs from the new one', async () => {
    // `0` is falsy and a stored zero is a real answer, not an absent one.
    h.dbResults.push([{ total: '3', current: 0 }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE })
    )

    expect(h.setValueWithType).toHaveBeenCalled()
  })

  it('does not write a zero back over a stored zero when the last movement goes', async () => {
    h.dbResults.push([{ total: '0', current: 0 }])

    await recalculatePurchaseOrderLineReceived(
      event({ stock_movement_purchase_order_line: PO_LINE }, { action: 'deleted' })
    )

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('the batched roll-up', () => {
  const LINES = ['pol_1', 'pol_2', 'pol_3']

  /** The two reads the batch makes: the grouped SUM, then the stored totals. */
  function queueBatchReads(
    totals: Array<[string, number]>,
    stored: Array<[string, number | null]>
  ) {
    h.dbResults.push(
      totals.map(([lineId, total]) => ({ lineId, total: String(total) })),
      stored.map(([entityId, valueNumber]) => ({ entityId, valueNumber }))
    )
  }

  it('reads every line in TWO queries, not two per line', async () => {
    const before = h.dbResults.length
    queueBatchReads(
      LINES.map((id, i) => [id, i + 1] as [string, number]),
      []
    )
    expect(h.dbResults.length - before).toBe(2)

    await recalculatePurchaseOrderLineRollups('org_1', LINES, PURCHASE_ORDER_LINE_ROLLUPS.received)

    expect(h.setValueWithType).toHaveBeenCalledTimes(3)
  })

  it('writes only the lines whose total actually moved', async () => {
    queueBatchReads(
      [
        ['pol_1', 5],
        ['pol_2', 9],
        ['pol_3', 2],
      ],
      [
        ['pol_1', 5],
        ['pol_2', 4],
        ['pol_3', 2],
      ]
    )

    await recalculatePurchaseOrderLineRollups('org_1', LINES, PURCHASE_ORDER_LINE_ROLLUPS.received)

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'poldef:pol_2', value: { type: 'number', value: 9 } })
    )
  })

  it('reads a line with no child rows as zero rather than dropping it', async () => {
    queueBatchReads([['pol_1', 5]], [['pol_2', 3]])

    await recalculatePurchaseOrderLineRollups('org_1', LINES, PURCHASE_ORDER_LINE_ROLLUPS.received)

    // pol_1 moves to 5; pol_2 falls back to 0; pol_3 has neither a total nor a
    // stored value, and an unreadable stored value always writes.
    expect(h.setValueWithType).toHaveBeenCalledTimes(3)
    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'poldef:pol_2', value: { type: 'number', value: 0 } })
    )
  })

  it('derives the order ONCE for the whole set, naming only the lines that moved', async () => {
    queueBatchReads(
      [
        ['pol_1', 5],
        ['pol_2', 9],
      ],
      [['pol_1', 5]]
    )

    await recalculatePurchaseOrderLineRollups('org_1', LINES, PURCHASE_ORDER_LINE_ROLLUPS.received)

    expect(h.recalculatePurchaseOrderStatusesForLines).toHaveBeenCalledTimes(1)
    expect(h.recalculatePurchaseOrderStatusesForLines).toHaveBeenCalledWith({
      organizationId: 'org_1',
      purchaseOrderLineInstanceIds: ['pol_2', 'pol_3'],
      evidence: 'receipt',
    })
    // And never the per-line entry point, which is what the ten-fold was.
    expect(h.recalculatePurchaseOrderStatuses).not.toHaveBeenCalled()
  })

  it('derives nothing when no line moved', async () => {
    queueBatchReads(
      [
        ['pol_1', 5],
        ['pol_2', 9],
        ['pol_3', 1],
      ],
      [
        ['pol_1', 5],
        ['pol_2', 9],
        ['pol_3', 1],
      ]
    )

    await recalculatePurchaseOrderLineRollups('org_1', LINES, PURCHASE_ORDER_LINE_ROLLUPS.received)

    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.recalculatePurchaseOrderStatusesForLines).not.toHaveBeenCalled()
  })

  it('publishes every changed line in ONE realtime call', async () => {
    queueBatchReads(
      [
        ['pol_1', 5],
        ['pol_2', 9],
      ],
      []
    )

    await recalculatePurchaseOrderLineRollups('org_1', LINES, PURCHASE_ORDER_LINE_ROLLUPS.received)

    expect(h.publishFieldValueUpdates).toHaveBeenCalledTimes(1)
    expect(h.publishFieldValueUpdates.mock.calls[0]?.[2]).toHaveLength(3)
  })

  it('dedupes a line that appears twice in the set', async () => {
    h.dbResults.push([{ total: '8', current: null }])

    await recalculatePurchaseOrderLineRollups(
      'org_1',
      [PO_LINE, PO_LINE],
      PURCHASE_ORDER_LINE_ROLLUPS.received
    )

    // One line means the single-line path, which is one query rather than two.
    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an empty set', async () => {
    await recalculatePurchaseOrderLineRollups('org_1', [], PURCHASE_ORDER_LINE_ROLLUPS.received)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})
