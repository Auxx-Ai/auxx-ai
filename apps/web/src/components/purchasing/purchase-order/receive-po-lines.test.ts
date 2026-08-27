// apps/web/src/components/purchasing/purchase-order/receive-po-lines.test.ts

import { describe, expect, it } from 'vitest'
import {
  activeLines,
  buildReceivePoInput,
  outstandingQuantity,
  prefillDraft,
  type ReceivablePoLine,
} from './receive-po-lines'

function line(overrides: Partial<ReceivablePoLine> = {}): ReceivablePoLine {
  return {
    purchaseOrderLineId: 'pol_1',
    partId: 'part_1',
    description: null,
    quantityOrdered: 10,
    quantityReceived: 0,
    ...overrides,
  }
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
  it('assumes the whole order arrived', () => {
    const draft = prefillDraft([line()])
    expect(draft.pol_1).toEqual({ quantity: 10 })
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

  it('carries no price — a draft row is a quantity and nothing else', () => {
    // The agreed price never round-trips through the browser: the server reads
    // `purchase_order_line_expected_unit_price` itself.
    expect(Object.keys(prefillDraft([line()]).pol_1 ?? {})).toEqual(['quantity'])
  })
})

describe('activeLines', () => {
  const lines = [line({ purchaseOrderLineId: 'a' }), line({ purchaseOrderLineId: 'b' })]

  it('excludes a line receiving nothing', () => {
    const draft = { a: { quantity: 10 }, b: { quantity: 0 } }
    expect(activeLines(lines, draft).map((row) => row.line.purchaseOrderLineId)).toEqual(['a'])
  })

  it('excludes a negative or non-finite quantity', () => {
    const draft = { a: { quantity: -1 }, b: { quantity: Number.NaN } }
    expect(activeLines(lines, draft)).toEqual([])
  })
})

describe('buildReceivePoInput', () => {
  it('🛑 sends only the lines being received', () => {
    // Rule 1. `receivePurchaseOrder` refuses a line at zero and refuses the whole
    // receipt with it, so an untouched row must never reach the wire — otherwise
    // a partly-received order could not be received at all.
    const lines = [line({ purchaseOrderLineId: 'a' }), line({ purchaseOrderLineId: 'b' })]
    const draft = { a: { quantity: 10 }, b: { quantity: 0 } }
    const input = buildReceivePoInput(lines, draft, META)
    expect(input?.lines).toHaveLength(1)
    expect(input?.lines[0]).toEqual({
      partId: 'part_1',
      purchaseOrderLineId: 'a',
      quantity: 10,
    })
  })

  it('🛑 states no price and no header amounts', () => {
    // The whole point of the change: the browser cannot assert what stock cost.
    const input = buildReceivePoInput([line()], prefillDraft([line()]), META)
    expect(input?.lines[0]).not.toHaveProperty('unitPrice')
    expect(input?.lines[0]).not.toHaveProperty('weight')
    expect(input).not.toHaveProperty('shipping')
    expect(input).not.toHaveProperty('tax')
    expect(input).not.toHaveProperty('discount')
    expect(input).not.toHaveProperty('taxRecoverable')
    expect(input).not.toHaveProperty('basis')
  })

  it('is null when nothing is being received, so the button stays disabled', () => {
    const input = buildReceivePoInput([line()], { pol_1: { quantity: 0 } }, META)
    expect(input).toBeNull()
  })

  it('omits vendorPartId when the line names none', () => {
    const input = buildReceivePoInput([line()], prefillDraft([line()]), META)
    expect(input?.lines[0]).not.toHaveProperty('vendorPartId')
  })

  it('passes vendorPartId when it does', () => {
    const withVendor = line({ vendorPartId: 'vp_1' })
    const input = buildReceivePoInput([withVendor], prefillDraft([withVendor]), META)
    expect(input?.lines[0]).toMatchObject({ vendorPartId: 'vp_1' })
  })

  it('allows an over-receipt rather than clamping it to the outstanding amount', () => {
    // The vendor shipped 12 against an order for 10. Capping it here would hide
    // the discrepancy at the one moment somebody can see the packing slip.
    const input = buildReceivePoInput([line()], { pol_1: { quantity: 12 } }, META)
    expect(input?.lines[0]?.quantity).toBe(12)
  })

  it('drops a blank reference and reason', () => {
    const input = buildReceivePoInput([line()], prefillDraft([line()]), {
      ...META,
      reference: '  ',
    })
    expect(input).not.toHaveProperty('reference')
    expect(input).not.toHaveProperty('reason')
  })

  it('sends the accounting date it was given', () => {
    const input = buildReceivePoInput([line()], prefillDraft([line()]), {
      ...META,
      occurredAt: '2026-01-04T09:30:00.000Z',
    })
    expect(input?.occurredAt.toISOString()).toBe('2026-01-04T09:30:00.000Z')
  })
})
