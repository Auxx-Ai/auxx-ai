// packages/lib/src/purchasing/bill-intake/__tests__/schema.test.ts
//
// The invoice transcription contract, with no model involved. Two things are
// pinned: the JSON Schema the provider enforces and the zod parser that
// checks what actually came back describe the SAME shape, and a malformed
// response is an error rather than a half-bill.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { parseTranscribedInvoice, TRANSCRIBED_INVOICE_JSON_SCHEMA } from '../schema'

const INVOICE = {
  vendorName: 'Acme Fasteners GmbH',
  vendorEmail: 'sales@acme.example',
  vendorAddress: null,
  invoiceNumber: 'INV-88213',
  invoiceDate: '2026-09-01',
  dueDate: '2026-10-01',
  paymentTerms: 'Net 30',
  purchaseOrderReference: 'PO-0042',
  currency: 'eur',
  subtotalText: '4,788.00',
  shippingText: '24.00',
  taxText: null,
  totalText: '4,812.00',
  lines: [
    {
      lineNumber: 1,
      vendorCode: 'AF-4420',
      customerCode: 'OUR-PART-9',
      description: 'Hex bolt M8x40 zinc',
      quantity: 500,
      unit: 'pcs',
      unitPriceText: '0.42',
      lineTotalText: '210.00',
    },
  ],
}

/** The property names the model is told about, at both levels. */
function jsonSchemaKeys(): { invoice: string[]; line: string[] } {
  const root = TRANSCRIBED_INVOICE_JSON_SCHEMA as never as {
    properties: Record<string, { properties?: Record<string, unknown>; items?: never }>
  }
  const lines = root.properties.lines as never as {
    items: { properties: Record<string, unknown> }
  }
  return {
    invoice: Object.keys(root.properties).sort(),
    line: Object.keys(lines.items.properties).sort(),
  }
}

describe('the invoice transcription schema', () => {
  it('describes exactly the fields the parser produces', () => {
    const parsed = parseTranscribedInvoice(INVOICE)
    const keys = jsonSchemaKeys()

    expect(Object.keys(parsed).sort()).toEqual(keys.invoice)
    expect(Object.keys(parsed.lines[0] ?? {}).sort()).toEqual(keys.line)
  })

  it('requires every field of the model, so an omission is a refusal not a null', () => {
    const root = TRANSCRIBED_INVOICE_JSON_SCHEMA as never as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect([...root.required].sort()).toEqual(Object.keys(root.properties).sort())

    const lines = root.properties.lines as never as {
      items: { required: string[]; properties: Record<string, unknown> }
    }
    expect([...lines.items.required].sort()).toEqual(Object.keys(lines.items.properties).sort())
  })

  it('carries no priceBreaks and no leadTime, unlike the quote line', () => {
    const keys = jsonSchemaKeys().line
    expect(keys).not.toContain('priceBreaks')
    expect(keys).not.toContain('leadTime')
  })

  it('🛑 keeps every money field as the string the vendor printed', () => {
    const parsed = parseTranscribedInvoice(INVOICE)
    expect(parsed.totalText).toBe('4,812.00')
    expect(parsed.lines[0]?.unitPriceText).toBe('0.42')
  })

  it('🛑 keeps a printed total that disagrees with the line sum, disagreeing', () => {
    const parsed = parseTranscribedInvoice(INVOICE)
    // 4,788.00 of lines plus 24.00 shipping against a printed 4,812.00 — both
    // survive; nothing here reconciles them.
    expect(parsed.subtotalText).toBe('4,788.00')
    expect(parsed.totalText).toBe('4,812.00')
  })

  it('🔑 round-trips purchaseOrderReference and customerCode', () => {
    const parsed = parseTranscribedInvoice(INVOICE)
    expect(parsed.purchaseOrderReference).toBe('PO-0042')
    expect(parsed.lines[0]?.customerCode).toBe('OUR-PART-9')
  })

  it('uppercases the currency and blanks an empty one', () => {
    expect(parseTranscribedInvoice(INVOICE).currency).toBe('EUR')
    expect(parseTranscribedInvoice({ ...INVOICE, currency: '   ' }).currency).toBeNull()
  })

  it('accepts a quantity the model printed as a string', () => {
    const parsed = parseTranscribedInvoice({
      ...INVOICE,
      lines: [{ ...INVOICE.lines[0], quantity: '1,000' }],
    })
    expect(parsed.lines[0]?.quantity).toBe(1000)
  })

  it('tolerates a missing lines array', () => {
    const parsed = parseTranscribedInvoice({ vendorName: 'Acme' })
    expect(parsed.lines).toEqual([])

    const oneLine = parseTranscribedInvoice({ lines: [{ vendorCode: 'X-9' }] })
    expect(oneLine.lines[0]?.vendorCode).toBe('X-9')
    expect(oneLine.lines[0]?.customerCode).toBeNull()
  })

  it('🛑 a malformed response is an error, not a half-bill', () => {
    expect(() => parseTranscribedInvoice('not an object')).toThrow(UnprocessableEntityError)
    expect(() => parseTranscribedInvoice({ lines: 'nope' })).toThrow(UnprocessableEntityError)
    expect(() => parseTranscribedInvoice(null)).toThrow(UnprocessableEntityError)
  })
})
