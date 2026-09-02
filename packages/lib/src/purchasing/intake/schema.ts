// packages/lib/src/purchasing/intake/schema.ts

/**
 * The one schema the transcription pass is held to, in both the shapes it is
 * needed in: a plain JSON Schema object for the provider's structured-output
 * enforcement, and a zod parser for what actually comes back.
 *
 * 🛑 Both are needed and neither is redundant. `LLMInvocationRequest.structuredOutput`
 * takes a JSON Schema and the providers do enforce it (Anthropic through a forced
 * synthetic tool, OpenAI through `response_format: json_schema`), but enforcement is
 * the provider's word for it: a BYO model whose `supports.structured` is unknown
 * fails the gate OPEN, and `LLMOrchestrator.parseStructuredOutput` will happily
 * hand back whatever JSON it could scrape out of the prose. A malformed response
 * has to be an ERROR, not a half-draft that reads as a read of the document.
 *
 * 🛑 Every money field is a STRING here, deliberately. The vendor's document is
 * transcribed as printed — `'1,234.56'`, `'€0.42'`, `'POA'` — and turned into
 * minor units exactly once, in `parseIntakeMoney`. A `number` in this schema
 * would move that conversion into the model, where it is neither deterministic
 * nor inspectable, and `'1.234,56'` from a German quote would arrive as `1.234`.
 */

import { z } from 'zod'
import { UnprocessableEntityError } from '../../errors'
import type { TranscribedLine, TranscribedPriceBreak, TranscribedQuote } from './client'

/** A string field the model may omit, may null, and may pad. */
const text = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return null
    const trimmed = String(value).trim()
    return trimmed === '' ? null : trimmed
  })

/**
 * A count the model may print as `'500'` or `'1.000'`.
 *
 * Quantities are the one non-money number transcribed, and they are genuinely
 * numeric, so a lenient coercion is right here where it would be wrong on a
 * price: there is no currency, no separator ambiguity worth preserving, and a
 * quantity that will not parse is more useful as `null` than as `NaN`.
 */
const count = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    const cleaned = value.replace(/[^0-9.-]/g, '')
    if (!cleaned) return null
    const parsed = Number.parseFloat(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  })

const priceBreakSchema = z.object({
  minQuantity: count,
  unitPriceText: text,
})

const lineSchema = z.object({
  lineNumber: count,
  vendorCode: text,
  description: text,
  quantity: count,
  unit: text,
  unitPriceText: text,
  lineTotalText: text,
  leadTime: text,
  priceBreaks: z.array(priceBreakSchema).optional(),
})

const quoteSchema = z.object({
  vendorName: text,
  vendorEmail: text,
  vendorPhone: text,
  vendorAddress: text,
  quoteNumber: text,
  quoteDate: text,
  validUntil: text,
  currency: text,
  subtotalText: text,
  shippingText: text,
  taxText: text,
  totalText: text,
  lines: z.array(lineSchema).optional(),
})

/**
 * The JSON Schema handed to the provider.
 *
 * Kept as a literal rather than generated from the zod schema: `structuredOutput.schema`
 * is `JSON.stringify`d straight onto the wire, and a generator's output would be
 * one dependency upgrade away from changing what the model is told without
 * anything in this repo changing. `schema.test.ts` pins the two in lockstep.
 */
export const TRANSCRIBED_QUOTE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vendorName',
    'vendorEmail',
    'vendorPhone',
    'vendorAddress',
    'quoteNumber',
    'quoteDate',
    'validUntil',
    'currency',
    'subtotalText',
    'shippingText',
    'taxText',
    'totalText',
    'lines',
  ],
  properties: {
    vendorName: { type: ['string', 'null'], description: 'The selling company, as printed' },
    vendorEmail: { type: ['string', 'null'] },
    vendorPhone: { type: ['string', 'null'] },
    vendorAddress: { type: ['string', 'null'] },
    quoteNumber: { type: ['string', 'null'], description: "The vendor's own document number" },
    quoteDate: { type: ['string', 'null'], description: 'ISO date, or the raw string as printed' },
    validUntil: { type: ['string', 'null'] },
    currency: { type: ['string', 'null'], description: 'ISO 4217, uppercased' },
    subtotalText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
    shippingText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
    taxText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
    totalText: {
      type: ['string', 'null'],
      description:
        "The vendor's printed grand total. Copy it exactly, even when it disagrees with the sum of the lines.",
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'lineNumber',
          'vendorCode',
          'description',
          'quantity',
          'unit',
          'unitPriceText',
          'lineTotalText',
          'leadTime',
          'priceBreaks',
        ],
        properties: {
          lineNumber: { type: ['number', 'null'] },
          vendorCode: {
            type: ['string', 'null'],
            description: "The vendor's own part/item code for this line, exactly as printed",
          },
          description: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], description: 'pcs, kg, m, box, …' },
          unitPriceText: { type: ['string', 'null'], description: 'As printed, with separators' },
          lineTotalText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
          leadTime: { type: ['string', 'null'] },
          priceBreaks: {
            type: 'array',
            description:
              'Quantity breaks printed against this line, e.g. "100 @ 4.20 / 500 @ 3.90". Empty when the line prints one price.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['minQuantity', 'unitPriceText'],
              properties: {
                minQuantity: { type: ['number', 'null'] },
                unitPriceText: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
  },
}

/**
 * The instruction that rides in front of the document.
 *
 * 🛑 "Transcribe, never compute" is the whole prompt. It is the same rule
 * `docs/inventory-costing-architecture-guide.md` states for a bill's totals: a
 * printed total that disagrees with the line sum is either the vendor's
 * arithmetic (real, and ours to honour) or a line we failed to read (a defect a
 * silent fix would hide). Either way the model reconciling it destroys the
 * evidence.
 */
export const TRANSCRIBE_QUOTE_PROMPT = [
  'You are transcribing a vendor quotation into structured data.',
  '',
  'Rules:',
  '1. Transcribe what is PRINTED. Never calculate, correct, convert or reconcile anything.',
  '2. If the printed grand total does not equal the sum of the lines, copy both as printed.',
  '3. Every money field is a string, copied character for character, including thousands',
  '   separators and currency symbols. Do not turn "1,234.56" into 1234.56.',
  '4. Copy the vendor line code exactly, including case, dashes and leading zeros.',
  '5. When a line prints quantity breaks ("100 @ 4.20 / 500 @ 3.90"), put every break in',
  '   priceBreaks and leave unitPriceText as whatever price the line itself shows.',
  '6. Use null for anything the document does not state. Never invent a value.',
  '7. Include every line, in the order printed, including freight, surcharges and tooling.',
].join('\n')

function toPriceBreak(raw: z.infer<typeof priceBreakSchema>): TranscribedPriceBreak {
  return { minQuantity: raw.minQuantity ?? 0, unitPriceText: raw.unitPriceText }
}

function toLine(raw: z.infer<typeof lineSchema>): TranscribedLine {
  return {
    lineNumber: raw.lineNumber,
    vendorCode: raw.vendorCode,
    description: raw.description,
    quantity: raw.quantity,
    unit: raw.unit,
    unitPriceText: raw.unitPriceText,
    lineTotalText: raw.lineTotalText,
    leadTime: raw.leadTime,
    priceBreaks: (raw.priceBreaks ?? []).map(toPriceBreak),
  }
}

/**
 * Validate one model response into a {@link TranscribedQuote}.
 *
 * Throws {@link UnprocessableEntityError} rather than returning a partial: a
 * draft built from half a response is indistinguishable, on the review screen,
 * from a quote whose other half was genuinely blank.
 *
 * @param raw The parsed `structured_output`, or `JSON.parse` of the content.
 */
export function parseTranscribedQuote(raw: unknown): TranscribedQuote {
  const result = quoteSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.join('.') || 'response'
    throw new UnprocessableEntityError(
      `The model's transcription did not match the quote schema (${where}: ${issue?.message ?? 'invalid'})`
    )
  }

  const value = result.data
  return {
    vendorName: value.vendorName,
    vendorEmail: value.vendorEmail,
    vendorPhone: value.vendorPhone,
    vendorAddress: value.vendorAddress,
    quoteNumber: value.quoteNumber,
    quoteDate: value.quoteDate,
    validUntil: value.validUntil,
    currency: value.currency ? value.currency.toUpperCase() : null,
    subtotalText: value.subtotalText,
    shippingText: value.shippingText,
    taxText: value.taxText,
    totalText: value.totalText,
    lines: (value.lines ?? []).map(toLine),
  }
}
