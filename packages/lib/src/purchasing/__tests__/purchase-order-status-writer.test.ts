// packages/lib/src/purchasing/__tests__/purchase-order-status-writer.test.ts
//
// `purchase_order_receipt_status` and `_billing_status` are declared
// `creatable: false, updatable: false, computed: true` — unwritable by a human
// by construction — so if this module is not their writer they are NULL forever.
//
// The pull-forward half is the sharper risk: this is the ONE derived writer
// allowed to touch the ACTION field, and every guard below is the difference
// between "a receipt records that the order is live" and "a straggler receipt
// silently reopens an order somebody canceled".

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  setValueWithType: vi.fn(),
  createFieldValueContext: vi.fn(),
  requireCachedEntityDefId: vi.fn(),
  publishFieldValueUpdates: vi.fn(),
  /** Result sets the module's queries consume, in call order. */
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
      optionId: 'optionId',
      relatedEntityId: 'relatedEntityId',
    },
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
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: () => 'SINGLE_SELECT' }))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))

import {
  recalculatePurchaseOrderStatuses,
  recalculatePurchaseOrderStatusesForLines,
} from '../purchase-order-status-writer'

const ORG = 'org_1'
const PO_LINE = 'poline-1'
const PO = 'po-1'

const FIELDS = {
  purchase_order_line_purchase_order: { id: 'fld-po-rel', type: 'RELATIONSHIP' },
  purchase_order_line_quantity_ordered: { id: 'fld-ordered', type: 'NUMBER' },
  purchase_order_line_quantity_received: { id: 'fld-received', type: 'NUMBER' },
  purchase_order_line_quantity_billed: { id: 'fld-billed', type: 'NUMBER' },
  purchase_order_status: { id: 'fld-status', type: 'SINGLE_SELECT' },
  purchase_order_receipt_status: { id: 'fld-receipt', type: 'SINGLE_SELECT' },
  purchase_order_billing_status: { id: 'fld-billing', type: 'SINGLE_SELECT' },
}

/**
 * Queue the ONE read the module makes.
 *
 * ⚡ Changed with the query fold: the parent order, the order's lines and the
 * order's current SELECT values used to be three sequential statements and are
 * a single one now, so every row carries the order id and the order's three
 * option values alongside that line's quantities. The `it()` bodies below are
 * untouched — they still describe the reads in the same vocabulary; only this
 * helper knows the shape changed.
 *
 * An orphaned line (`order: null`) returns no rows at all, which is exactly what
 * the folded query does when its anchor subquery resolves to NULL.
 */
function queueReads(options: {
  order?: string | null
  lines?: Array<{ ordered: number | null; received: number | null; billed: number | null }>
  current?: Array<{ fieldId: string; optionId: string | null }>
}) {
  if (options.order === null) {
    h.dbResults.push([])
    return
  }
  const optionFor = (fieldId: string) =>
    (options.current ?? []).find((row) => row.fieldId === fieldId)?.optionId ?? null

  const lines = options.lines ?? [{ ordered: 10, received: 0, billed: 0 }]
  h.dbResults.push(
    lines.map((line) => ({
      orderId: options.order ?? PO,
      ...line,
      statusOption: optionFor('fld-status'),
      receiptStatusOption: optionFor('fld-receipt'),
      billingStatusOption: optionFor('fld-billing'),
    }))
  )
}

/** The `(fieldId, optionId)` pairs written this call. */
function writes(): Array<[string, string]> {
  return h.setValueWithType.mock.calls.map((call) => [
    call[1].fieldId as string,
    (call[1].value as { optionId: string }).optionId,
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbResults = []
  h.bySystemAttributes.mockResolvedValue(FIELDS)
  h.createFieldValueContext.mockReturnValue({ organizationId: ORG })
  h.requireCachedEntityDefId.mockResolvedValue('podef')
  h.setValueWithType.mockResolvedValue([])
  h.publishFieldValueUpdates.mockResolvedValue(undefined)
})

describe('the derived statuses', () => {
  it('writes both axes onto the ORDER, resolved from the line', async () => {
    queueReads({ lines: [{ ordered: 10, received: 10, billed: 4 }] })

    const result = await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(result.isOk()).toBe(true)
    expect(h.setValueWithType).toHaveBeenCalledWith(
      { organizationId: ORG },
      expect.objectContaining({
        recordId: `podef:${PO}`,
        fieldId: 'fld-receipt',
        value: { type: 'option', optionId: 'received' },
      })
    )
    expect(writes()).toContainEqual(['fld-billing', 'partially_billed'])
  })

  it('sums across ALL the order’s lines, not just the one that moved', async () => {
    queueReads({
      lines: [
        { ordered: 10, received: 10, billed: 0 },
        { ordered: 10, received: 0, billed: 0 },
      ],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes()).toContainEqual(['fld-receipt', 'partially_received'])
  })

  it('reads a line with no quantity values at all as zeroes rather than dropping it', async () => {
    queueReads({
      lines: [
        { ordered: 10, received: 10, billed: 10 },
        { ordered: null, received: null, billed: null },
      ],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    // The second line is ordered=0/received=0, which is satisfied — so the
    // order still completes, but only because it was READ, not skipped.
    expect(writes()).toContainEqual(['fld-receipt', 'received'])
  })

  it('publishes exactly what it wrote', async () => {
    queueReads({
      lines: [{ ordered: 10, received: 4, billed: 0 }],
      current: [{ fieldId: 'fld-billing', optionId: 'not_billed' }],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    const entries = h.publishFieldValueUpdates.mock.calls[0]?.[2] as Array<{
      value: { optionId: string }
    }>
    expect(entries).toHaveLength(1)
    expect(entries[0]?.value).toEqual({ type: 'option', optionId: 'partially_received' })
  })
})

describe('write only the diff', () => {
  it('writes nothing at all when both derived values already match', async () => {
    queueReads({
      lines: [{ ordered: 10, received: 10, billed: 10 }],
      current: [
        { fieldId: 'fld-receipt', optionId: 'received' },
        { fieldId: 'fld-billing', optionId: 'billed' },
        { fieldId: 'fld-status', optionId: 'issued' },
      ],
    })

    const result = await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
    expect(result._unsafeUnwrap()).toEqual({})
  })

  it('writes only the axis that moved', async () => {
    queueReads({
      lines: [{ ordered: 10, received: 10, billed: 0 }],
      current: [
        { fieldId: 'fld-receipt', optionId: 'partially_received' },
        { fieldId: 'fld-billing', optionId: 'not_billed' },
        { fieldId: 'fld-status', optionId: 'issued' },
      ],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes()).toEqual([['fld-receipt', 'received']])
  })
})

describe('the draft -> issued pull-forward', () => {
  const RECEIPT_LINES = [{ ordered: 10, received: 4, billed: 0 }]

  it('moves a draft order to issued on a receipt', async () => {
    queueReads({
      lines: RECEIPT_LINES,
      current: [{ fieldId: 'fld-status', optionId: 'draft' }],
    })

    const result = await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes()).toContainEqual(['fld-status', 'issued'])
    expect(result._unsafeUnwrap().status).toBe('issued')
  })

  it('records BOTH facts at once — the whole point of the three-field split', async () => {
    queueReads({
      lines: RECEIPT_LINES,
      current: [{ fieldId: 'fld-status', optionId: 'draft' }],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes()).toContainEqual(['fld-receipt', 'partially_received'])
    expect(writes()).toContainEqual(['fld-status', 'issued'])
  })

  it('does NOT move a closed order — a straggler receipt must not reopen it', async () => {
    queueReads({
      lines: RECEIPT_LINES,
      current: [{ fieldId: 'fld-status', optionId: 'closed' }],
    })

    const result = await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes().map(([fieldId]) => fieldId)).not.toContain('fld-status')
    expect(result._unsafeUnwrap().status).toBeUndefined()
  })

  it('does NOT move a canceled order', async () => {
    queueReads({
      lines: RECEIPT_LINES,
      current: [{ fieldId: 'fld-status', optionId: 'canceled' }],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes().map(([fieldId]) => fieldId)).not.toContain('fld-status')
  })

  it('leaves an issued order issued — it never rewrites the value it already holds', async () => {
    queueReads({
      lines: RECEIPT_LINES,
      current: [{ fieldId: 'fld-status', optionId: 'issued' }],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes().map(([fieldId]) => fieldId)).not.toContain('fld-status')
  })

  it('does NOT pull forward on BILLING evidence — this business prepays', async () => {
    queueReads({
      lines: [{ ordered: 10, received: 4, billed: 4 }],
      current: [{ fieldId: 'fld-status', optionId: 'draft' }],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'billing',
    })

    expect(writes().map(([fieldId]) => fieldId)).not.toContain('fld-status')
  })

  it('does NOT pull forward when the receipt evidence nets to nothing', async () => {
    // The roll-up fires on a movement DELETE too. Losing the last receipt is
    // the opposite of evidence that the order was sent.
    queueReads({
      lines: [{ ordered: 10, received: 0, billed: 0 }],
      current: [{ fieldId: 'fld-status', optionId: 'draft' }],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes().map(([fieldId]) => fieldId)).not.toContain('fld-status')
  })

  it('does NOT pull forward an order with no recorded status', async () => {
    queueReads({ lines: RECEIPT_LINES, current: [] })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(writes().map(([fieldId]) => fieldId)).not.toContain('fld-status')
  })

  it('declares purchase_order_status — and only that — as a bypassed field guard', async () => {
    queueReads({
      lines: RECEIPT_LINES,
      current: [{ fieldId: 'fld-status', optionId: 'draft' }],
    })

    await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    const options = h.createFieldValueContext.mock.calls[0]?.[4] as {
      bypassFieldGuards: Set<string>
    }
    expect([...options.bypassFieldGuards]).toEqual(['purchase_order_status'])
  })
})

describe('the no-op paths', () => {
  it('is a silent no-op for a line with no purchase order', async () => {
    queueReads({ order: null })

    const result = await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(result._unsafeUnwrap()).toEqual({})
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('writes nothing when the org lacks one of the derived status fields', async () => {
    h.bySystemAttributes.mockResolvedValue({
      ...FIELDS,
      purchase_order_receipt_status: null,
    })

    const result = await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(result.isOk()).toBe(true)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('returns err rather than throwing, so the committed line roll-up survives', async () => {
    h.bySystemAttributes.mockRejectedValue(new Error('cache exploded'))

    const result = await recalculatePurchaseOrderStatuses({
      organizationId: ORG,
      purchaseOrderLineInstanceId: PO_LINE,
      evidence: 'receipt',
    })

    expect(result.isErr()).toBe(true)
  })
})

describe('the batched pass', () => {
  /**
   * The distinct-orders read, then one folded read per order. The batched pass
   * is anchored on the ORDER, so its rows look identical to the per-line one's.
   */
  function queueBatch(orders: string[], perOrder: () => void) {
    h.dbResults.push(orders.map((relatedEntityId) => ({ relatedEntityId })))
    for (const _order of orders) perOrder()
  }

  it('derives ONE order once, however many of its lines moved', async () => {
    queueBatch([PO], () => queueReads({ lines: [{ ordered: 10, received: 10, billed: 0 }] }))

    const result = await recalculatePurchaseOrderStatusesForLines({
      organizationId: ORG,
      purchaseOrderLineInstanceIds: ['pol_1', 'pol_2', 'pol_3'],
      evidence: 'receipt',
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(1)
    expect(writes()).toContainEqual(['fld-receipt', 'received'])
  })

  it('derives each DISTINCT order behind the set, not just the first', async () => {
    // `receivePurchaseOrder` takes a line list, not an order — nothing stops a
    // caller naming lines of two different orders.
    queueBatch(['po-1', 'po-2'], () =>
      queueReads({ lines: [{ ordered: 10, received: 10, billed: 0 }] })
    )

    const result = await recalculatePurchaseOrderStatusesForLines({
      organizationId: ORG,
      purchaseOrderLineInstanceIds: ['pol_1', 'pol_2'],
      evidence: 'receipt',
    })

    expect(result._unsafeUnwrap()).toHaveLength(2)
  })

  it('carries the evidence through — a bill still never pulls an order forward', async () => {
    queueBatch([PO], () =>
      queueReads({
        lines: [{ ordered: 10, received: 4, billed: 4 }],
        current: [{ fieldId: 'fld-status', optionId: 'draft' }],
      })
    )

    await recalculatePurchaseOrderStatusesForLines({
      organizationId: ORG,
      purchaseOrderLineInstanceIds: ['pol_1'],
      evidence: 'billing',
    })

    expect(writes().map(([fieldId]) => fieldId)).not.toContain('fld-status')
  })

  it('reads nothing at all for an empty set', async () => {
    const result = await recalculatePurchaseOrderStatusesForLines({
      organizationId: ORG,
      purchaseOrderLineInstanceIds: [],
      evidence: 'receipt',
    })

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('is a silent no-op when every line in the set is orphaned', async () => {
    h.dbResults.push([])

    const result = await recalculatePurchaseOrderStatusesForLines({
      organizationId: ORG,
      purchaseOrderLineInstanceIds: ['pol_1'],
      evidence: 'receipt',
    })

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('returns err rather than throwing, like its per-line sibling', async () => {
    h.bySystemAttributes.mockRejectedValue(new Error('cache exploded'))

    const result = await recalculatePurchaseOrderStatusesForLines({
      organizationId: ORG,
      purchaseOrderLineInstanceIds: ['pol_1'],
      evidence: 'receipt',
    })

    expect(result.isErr()).toBe(true)
  })
})
