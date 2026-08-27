// apps/web/src/components/manufacturing/parts/receipt-input.test.ts

import { describe, expect, it } from 'vitest'
import { buildReceiptInput, type ReceiptFormState, receiptBreakdown } from './receipt-input'

/** A priced supplier row: $1.20 freight, 4.3% tariff, no other cost. */
const TERMS = { shippingCost: 120, tariffRate: 4.3, otherCost: null }

function formState(overrides: Partial<ReceiptFormState> = {}): ReceiptFormState {
  return {
    partId: 'part_1',
    quantity: 10,
    vendorPartId: 'vp_1',
    terms: TERMS,
    unitPrice: 4400,
    occurredAt: '2026-08-26T00:00:00.000Z',
    reference: '',
    reason: '',
    ...overrides,
  }
}

describe('receiptBreakdown', () => {
  it('applies the supplier adders to the price on screen', () => {
    const parts = receiptBreakdown(formState())
    // $44.00 + $1.20 freight + $1.89 tariff (4.3% of 4400 = 189.2 → 189)
    expect(parts).toEqual({
      base: 4400,
      freight: 120,
      tariff: 189,
      tariffRate: 4.3,
      other: 0,
      landed: 4709,
    })
  })

  it('keeps the adders when the price is edited', () => {
    // Freight and tariff still apply to a price the vendor actually charged, so
    // an edit is a new base under the same terms — not a reason to drop them.
    const parts = receiptBreakdown(formState({ unitPrice: 5000 }))
    expect(parts?.base).toBe(5000)
    expect(parts?.freight).toBe(120)
    expect(parts?.landed).toBe(5000 + 120 + 215)
  })

  it('is the bare price when the part has no supplier row', () => {
    const parts = receiptBreakdown(formState({ vendorPartId: null, terms: null, unitPrice: 4400 }))
    expect(parts).toMatchObject({ base: 4400, freight: 0, tariff: 0, other: 0, landed: 4400 })
  })

  it('has no answer without a price', () => {
    expect(receiptBreakdown(formState({ unitPrice: null }))).toBeNull()
  })

  it('parts always sum to the landed total', () => {
    for (const unitPrice of [1, 333, 4133, 99999]) {
      for (const tariffRate of [0, 4.3, 7.5, 10]) {
        const parts = receiptBreakdown(formState({ unitPrice, terms: { ...TERMS, tariffRate } }))
        expect(parts).not.toBeNull()
        const sum = parts!.base + parts!.freight + parts!.tariff + parts!.other
        // A breakdown whose lines do not visibly add up to its own total is worse
        // than no breakdown, and this one is shown to the person keying the cost.
        expect(sum).toBe(parts!.landed)
      }
    }
  })
})

describe('buildReceiptInput', () => {
  it('🛑 sends the BASE price and never a cost', () => {
    // The whole reason this module exists. The landed figure is the server's to
    // resolve — `purchasing.receiveStock` does not accept a `unitCost` at all —
    // so what goes on the wire is the price off the packing slip, edits included.
    const input = buildReceiptInput(formState({ unitPrice: 5000 }))
    expect(input?.vendorUnitPrice).toBe(5000)
    expect(input).not.toHaveProperty('unitCost')
  })

  it('sends the base the breakdown was computed from, not the landed total', () => {
    const state = formState()
    const breakdown = receiptBreakdown(state)
    expect(buildReceiptInput(state)?.vendorUnitPrice).toBe(breakdown?.base)
    expect(breakdown?.landed).not.toBe(breakdown?.base)
  })

  it('omits the supplier when the part has no row, and still prices the receipt', () => {
    const input = buildReceiptInput(formState({ vendorPartId: null, terms: null }))
    expect(input).not.toBeNull()
    expect(input).not.toHaveProperty('vendorPartId')
    expect(input?.vendorUnitPrice).toBe(4400)
  })

  it('refuses a non-positive quantity', () => {
    expect(buildReceiptInput(formState({ quantity: 0 }))).toBeNull()
    expect(buildReceiptInput(formState({ quantity: -3 }))).toBeNull()
    expect(buildReceiptInput(formState({ quantity: null }))).toBeNull()
    expect(buildReceiptInput(formState({ quantity: Number.NaN }))).toBeNull()
  })

  it('refuses a receipt that would land at zero cost', () => {
    // Mirrors `receiveStock`'s hard failure: a zero-cost receipt is worse than a
    // missing one because it looks like data. The server check is the real guard;
    // this one only keeps the button honest.
    expect(buildReceiptInput(formState({ unitPrice: null }))).toBeNull()
    expect(buildReceiptInput(formState({ unitPrice: 0, terms: null }))).toBeNull()
  })

  it('drops blank reference and reason rather than sending empty strings', () => {
    const input = buildReceiptInput(formState({ reference: '   ', reason: '' }))
    expect(input).not.toHaveProperty('reference')
    expect(input).not.toHaveProperty('reason')
  })

  it('trims a reference that was typed with padding', () => {
    expect(buildReceiptInput(formState({ reference: '  slip 88213 ' }))?.reference).toBe(
      'slip 88213'
    )
  })

  it('sends the accounting date the form was given, not today', () => {
    const input = buildReceiptInput(formState({ occurredAt: '2026-01-04T09:30:00.000Z' }))
    expect(input?.occurredAt.toISOString()).toBe('2026-01-04T09:30:00.000Z')
  })
})
