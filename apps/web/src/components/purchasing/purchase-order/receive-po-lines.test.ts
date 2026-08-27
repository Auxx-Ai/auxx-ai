// apps/web/src/components/purchasing/purchase-order/receive-po-lines.test.ts

import { describe, expect, it } from 'vitest'
import {
  activeLines,
  allocatedUnitCosts,
  buildReceivePoInput,
  outstandingQuantity,
  prefillDraft,
  type ReceiptHeader,
  type ReceivablePoLine,
  receiptSubtotal,
} from './receive-po-lines'

function line(overrides: Partial<ReceivablePoLine> = {}): ReceivablePoLine {
  return {
    purchaseOrderLineId: 'pol_1',
    partId: 'part_1',
    description: null,
    quantityOrdered: 10,
    quantityReceived: 0,
    expectedUnitPrice: 4400,
    ...overrides,
  }
}

const NO_HEADER: ReceiptHeader = {
  shipping: 0,
  tax: 0,
  discount: 0,
  taxRecoverable: false,
  basis: 'value',
}

const META = { occurredAt: '2026-08-26T00:00:00.000Z', reference: '', reason: '' }

describe('outstandingQuantity', () => {
  it('is ordered less received', () => {
    expect(outstandingQuantity(line({ quantityOrdered: 10, quantityReceived: 3 }))).toBe(7)
  })

  it('floors at zero for an over-received line', () => {
    // A negative prefill would submit as a receipt the server rightly refuses,
    // and over-receipt is a real state the match is meant to surface, not a bug.
    expect(outstandingQuantity(line({ quantityOrdered: 10, quantityReceived: 12 }))).toBe(0)
  })
})

describe('prefillDraft', () => {
  it('assumes the whole order arrived, at the agreed price', () => {
    const draft = prefillDraft([line()])
    expect(draft.pol_1).toEqual({ quantity: 10, unitPrice: 4400 })
  })

  it('prefills the OUTSTANDING amount, not the ordered amount', () => {
    // Reopening the dialog on a partly-received PO must offer the remainder.
    const draft = prefillDraft([line({ quantityReceived: 4 })])
    expect(draft.pol_1?.quantity).toBe(6)
  })

  it('prefills zero on a fully received order rather than a second delivery', () => {
    const draft = prefillDraft([line({ quantityReceived: 10 })])
    expect(draft.pol_1?.quantity).toBe(0)
  })
})

describe('activeLines', () => {
  const lines = [line({ purchaseOrderLineId: 'a' }), line({ purchaseOrderLineId: 'b' })]

  it('excludes a line receiving nothing', () => {
    const draft = { a: { quantity: 10, unitPrice: 4400 }, b: { quantity: 0, unitPrice: 4400 } }
    expect(activeLines(lines, draft).map((row) => row.line.purchaseOrderLineId)).toEqual(['a'])
  })

  it('excludes a negative or non-finite quantity', () => {
    const draft = {
      a: { quantity: -1, unitPrice: 4400 },
      b: { quantity: Number.NaN, unitPrice: 4400 },
    }
    expect(activeLines(lines, draft)).toEqual([])
  })
})

describe('allocatedUnitCosts', () => {
  const lines = [
    line({ purchaseOrderLineId: 'a', partId: 'p1' }),
    line({ purchaseOrderLineId: 'b', partId: 'p2' }),
  ]

  it('is the bare price when the header states no amounts', () => {
    const draft = { a: { quantity: 10, unitPrice: 4400 }, b: { quantity: 10, unitPrice: 4400 } }
    expect(allocatedUnitCosts(lines, draft, NO_HEADER)).toEqual({ a: 4400, b: 4400 })
  })

  it('🛑 spreads freight over ONLY the lines being received', () => {
    // The load-bearing rule. $100 freight across one received line is $100 on
    // that line; including the untouched line would halve it and understate the
    // cost of the goods that actually arrived.
    const draft = { a: { quantity: 10, unitPrice: 4400 }, b: { quantity: 0, unitPrice: 4400 } }
    const costs = allocatedUnitCosts(lines, draft, { ...NO_HEADER, shipping: 10000 })
    expect(costs.a).toBe(4400 + 1000)
    expect(costs.b).toBeUndefined()

    const bothReceived = {
      a: { quantity: 10, unitPrice: 4400 },
      b: { quantity: 10, unitPrice: 4400 },
    }
    const shared = allocatedUnitCosts(lines, bothReceived, { ...NO_HEADER, shipping: 10000 })
    expect(shared.a).toBe(4400 + 500)
    expect(shared.b).toBe(4400 + 500)
  })

  it('has nothing to allocate when no line is being received', () => {
    const draft = { a: { quantity: 0, unitPrice: 4400 }, b: { quantity: 0, unitPrice: 4400 } }
    expect(allocatedUnitCosts(lines, draft, { ...NO_HEADER, shipping: 10000 })).toEqual({})
  })
})

describe('receiptSubtotal', () => {
  it('counts only the lines being received', () => {
    const lines = [line({ purchaseOrderLineId: 'a' }), line({ purchaseOrderLineId: 'b' })]
    const draft = { a: { quantity: 2, unitPrice: 4400 }, b: { quantity: 0, unitPrice: 4400 } }
    expect(receiptSubtotal(lines, draft)).toBe(8800)
  })
})

describe('buildReceivePoInput', () => {
  it('sends one entry per received line, and nothing for the rest', () => {
    const lines = [line({ purchaseOrderLineId: 'a' }), line({ purchaseOrderLineId: 'b' })]
    const draft = { a: { quantity: 10, unitPrice: 4400 }, b: { quantity: 0, unitPrice: 4400 } }
    const input = buildReceivePoInput(lines, draft, NO_HEADER, META)
    expect(input?.lines).toHaveLength(1)
    expect(input?.lines[0]).toMatchObject({
      partId: 'part_1',
      purchaseOrderLineId: 'a',
      quantity: 10,
      unitPrice: 4400,
    })
  })

  it('is null when nothing is being received, so the button stays disabled', () => {
    const input = buildReceivePoInput(
      [line()],
      { pol_1: { quantity: 0, unitPrice: 4400 } },
      NO_HEADER,
      META
    )
    expect(input).toBeNull()
  })

  it('carries the header amounts and the basis through unchanged', () => {
    const header: ReceiptHeader = {
      shipping: 10000,
      tax: 500,
      discount: 250,
      taxRecoverable: true,
      basis: 'weight',
    }
    const input = buildReceivePoInput([line()], prefillDraft([line()]), header, META)
    expect(input).toMatchObject({
      shipping: 10000,
      tax: 500,
      discount: 250,
      taxRecoverable: true,
      basis: 'weight',
    })
  })

  it('omits vendorPartId and weight when the line carries neither', () => {
    const input = buildReceivePoInput([line()], prefillDraft([line()]), NO_HEADER, META)
    expect(input?.lines[0]).not.toHaveProperty('vendorPartId')
    expect(input?.lines[0]).not.toHaveProperty('weight')
  })

  it('passes vendorPartId and weight when it does', () => {
    const withTerms = line({ vendorPartId: 'vp_1', weight: 12.5 })
    const input = buildReceivePoInput([withTerms], prefillDraft([withTerms]), NO_HEADER, META)
    expect(input?.lines[0]).toMatchObject({ vendorPartId: 'vp_1', weight: 12.5 })
  })

  it('allows an over-receipt rather than clamping it to the outstanding amount', () => {
    // The vendor shipped 12 against an order for 10. Capping it here would hide
    // the discrepancy at the one moment somebody can see the packing slip.
    const input = buildReceivePoInput(
      [line()],
      { pol_1: { quantity: 12, unitPrice: 4400 } },
      NO_HEADER,
      META
    )
    expect(input?.lines[0]?.quantity).toBe(12)
  })

  it('drops a blank reference and reason', () => {
    const input = buildReceivePoInput([line()], prefillDraft([line()]), NO_HEADER, {
      ...META,
      reference: '  ',
    })
    expect(input).not.toHaveProperty('reference')
    expect(input).not.toHaveProperty('reason')
  })

  it('sends the accounting date it was given', () => {
    const input = buildReceivePoInput([line()], prefillDraft([line()]), NO_HEADER, {
      ...META,
      occurredAt: '2026-01-04T09:30:00.000Z',
    })
    expect(input?.occurredAt.toISOString()).toBe('2026-01-04T09:30:00.000Z')
  })
})
