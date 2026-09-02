// packages/lib/src/purchasing/intake/__tests__/schema.test.ts
//
// The transcription contract, with no model involved. Two things are pinned: the
// JSON Schema the provider enforces and the zod parser that checks what actually
// came back describe the SAME shape, and a malformed response is an error rather
// than a half-draft.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { parseTranscribedQuote, TRANSCRIBED_QUOTE_JSON_SCHEMA } from '../schema'

const QUOTE = {
  vendorName: 'Acme Fasteners GmbH',
  vendorEmail: 'sales@acme.example',
  vendorPhone: null,
  vendorAddress: null,
  quoteNumber: 'Q-77',
  quoteDate: '2026-09-01',
  validUntil: null,
  currency: 'eur',
  subtotalText: '4,788.00',
  shippingText: '24.00',
  taxText: null,
  totalText: '4,812.00',
  lines: [
    {
      lineNumber: 1,
      vendorCode: 'AF-4420',
      description: 'Hex bolt M8x40 zinc',
      quantity: 500,
      unit: 'pcs',
      unitPriceText: '0.42',
      lineTotalText: '210.00',
      leadTime: '2 weeks',
      priceBreaks: [
        { minQuantity: 100, unitPriceText: '4.20' },
        { minQuantity: 500, unitPriceText: '3.90' },
      ],
    },
  ],
}

/** The property names the model is told about, at both levels. */
function jsonSchemaKeys(): { quote: string[]; line: string[]; priceBreak: string[] } {
  const root = TRANSCRIBED_QUOTE_JSON_SCHEMA as never as {
    properties: Record<string, { properties?: Record<string, unknown>; items?: never }>
  }
  const lines = root.properties.lines as never as {
    items: { properties: Record<string, unknown> }
  }
  const breaks = lines.items.properties.priceBreaks as never as {
    items: { properties: Record<string, unknown> }
  }
  return {
    quote: Object.keys(root.properties).sort(),
    line: Object.keys(lines.items.properties).sort(),
    priceBreak: Object.keys(breaks.items.properties).sort(),
  }
}

describe('the transcription schema', () => {
  it('describes exactly the fields the parser produces', () => {
    const parsed = parseTranscribedQuote(QUOTE)
    const keys = jsonSchemaKeys()

    expect(Object.keys(parsed).sort()).toEqual(keys.quote)
    expect(Object.keys(parsed.lines[0] ?? {}).sort()).toEqual(keys.line)
    expect(Object.keys(parsed.lines[0]?.priceBreaks[0] ?? {}).sort()).toEqual(keys.priceBreak)
  })

  it('requires every field of the model, so an omission is a refusal not a null', () => {
    const root = TRANSCRIBED_QUOTE_JSON_SCHEMA as never as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect([...root.required].sort()).toEqual(Object.keys(root.properties).sort())
  })

  it('🛑 keeps every money field as the string the vendor printed', () => {
    const parsed = parseTranscribedQuote(QUOTE)
    expect(parsed.totalText).toBe('4,812.00')
    expect(parsed.lines[0]?.unitPriceText).toBe('0.42')
    expect(parsed.lines[0]?.priceBreaks[1]?.unitPriceText).toBe('3.90')
  })

  it('🛑 keeps a printed total that disagrees with the line sum, disagreeing', () => {
    const parsed = parseTranscribedQuote(QUOTE)
    // 4,788.00 of lines plus 24.00 shipping against a printed 4,812.00 — both
    // survive; nothing here reconciles them.
    expect(parsed.subtotalText).toBe('4,788.00')
    expect(parsed.totalText).toBe('4,812.00')
  })

  it('uppercases the currency and blanks an empty one', () => {
    expect(parseTranscribedQuote(QUOTE).currency).toBe('EUR')
    expect(parseTranscribedQuote({ ...QUOTE, currency: '   ' }).currency).toBeNull()
  })

  it('accepts a quantity the model printed as a string', () => {
    const parsed = parseTranscribedQuote({
      ...QUOTE,
      lines: [{ ...QUOTE.lines[0], quantity: '1,000' }],
    })
    expect(parsed.lines[0]?.quantity).toBe(1000)
  })

  it('tolerates a missing lines array and a missing priceBreaks array', () => {
    const parsed = parseTranscribedQuote({ vendorName: 'Acme' })
    expect(parsed.lines).toEqual([])

    const oneLine = parseTranscribedQuote({ lines: [{ vendorCode: 'X-9' }] })
    expect(oneLine.lines[0]?.priceBreaks).toEqual([])
    expect(oneLine.lines[0]?.vendorCode).toBe('X-9')
  })

  it('🛑 a malformed response is an error, not a half-draft', () => {
    expect(() => parseTranscribedQuote('not an object')).toThrow(UnprocessableEntityError)
    expect(() => parseTranscribedQuote({ lines: 'nope' })).toThrow(UnprocessableEntityError)
    expect(() => parseTranscribedQuote(null)).toThrow(UnprocessableEntityError)
  })
})
