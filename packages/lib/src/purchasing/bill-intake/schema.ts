// packages/lib/src/purchasing/bill-intake/schema.ts

/**
 * The invoice's transcription contract, the sibling of `intake/schema.ts`
 * (plans/money/tasks/58 §2.2): a plain JSON Schema object for the provider's
 * structured-output enforcement, and a zod parser for what actually comes
 * back. `intakeTextField` and `intakeCountField` are shared with the quote
 * schema by import, not by copy — the "transcribe, never compute" rule and
 * the "every money field is a string" rule are the same rule on both
 * documents.
 *
 * 🛑 Every money field is a STRING here, deliberately, for the same reason as
 * the quote: the invoice is transcribed as printed and turned into minor
 * units exactly once, in `parseIntakeMoney`.
 */

import { z } from 'zod'
import { UnprocessableEntityError } from '../../errors'
import { intakeCountField, intakeTextField } from '../intake/schema'
import type { TranscribeSpec } from '../intake/transcribe'
import type { TranscribedInvoice, TranscribedInvoiceLine } from './client'

const lineSchema = z.object({
  lineNumber: intakeCountField,
  vendorCode: intakeTextField,
  customerCode: intakeTextField,
  description: intakeTextField,
  quantity: intakeCountField,
  unit: intakeTextField,
  unitPriceText: intakeTextField,
  lineTotalText: intakeTextField,
  referencedInvoiceNumber: intakeTextField,
})

const invoiceSchema = z.object({
  vendorName: intakeTextField,
  vendorEmail: intakeTextField,
  vendorAddress: intakeTextField,
  invoiceNumber: intakeTextField,
  invoiceDate: intakeTextField,
  dueDate: intakeTextField,
  paymentTerms: intakeTextField,
  purchaseOrderReference: intakeTextField,
  referencedInvoiceNumber: intakeTextField,
  currency: intakeTextField,
  subtotalText: intakeTextField,
  shippingText: intakeTextField,
  taxText: intakeTextField,
  discountText: intakeTextField,
  totalText: intakeTextField,
  lines: z.array(lineSchema).optional(),
})

/**
 * The JSON Schema handed to the provider.
 *
 * Kept as a literal rather than generated from the zod schema, for the same
 * reason `TRANSCRIBED_QUOTE_JSON_SCHEMA` is: `structuredOutput.schema` is
 * `JSON.stringify`d straight onto the wire, and `schema.test.ts` pins the two
 * in lockstep.
 */
export const TRANSCRIBED_INVOICE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vendorName',
    'vendorEmail',
    'vendorAddress',
    'invoiceNumber',
    'invoiceDate',
    'dueDate',
    'paymentTerms',
    'purchaseOrderReference',
    'referencedInvoiceNumber',
    'currency',
    'subtotalText',
    'shippingText',
    'taxText',
    'discountText',
    'totalText',
    'lines',
  ],
  properties: {
    vendorName: { type: ['string', 'null'], description: 'The selling company, as printed' },
    vendorEmail: { type: ['string', 'null'] },
    vendorAddress: { type: ['string', 'null'] },
    invoiceNumber: { type: ['string', 'null'], description: "The vendor's own invoice number" },
    invoiceDate: {
      type: ['string', 'null'],
      description: 'ISO date, or the raw string as printed',
    },
    dueDate: { type: ['string', 'null'] },
    paymentTerms: { type: ['string', 'null'], description: 'As printed ("Net 30")' },
    purchaseOrderReference: {
      type: ['string', 'null'],
      description:
        "The buyer's purchase order number as printed on the invoice, exactly as printed, or null",
    },
    referencedInvoiceNumber: {
      type: ['string', 'null'],
      description:
        "A commercial invoice number this document is charged against - the goods supplier's " +
        'invoice number printed on a freight or customs invoice. Null unless the document names ' +
        'exactly one for the whole bill.',
    },
    currency: { type: ['string', 'null'], description: 'ISO 4217, uppercased' },
    subtotalText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
    shippingText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
    taxText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
    discountText: {
      type: ['string', 'null'],
      description:
        'The trade discount as printed, POSITIVE and without its minus sign. Never computed.',
    },
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
          'customerCode',
          'description',
          'quantity',
          'unit',
          'unitPriceText',
          'lineTotalText',
          'referencedInvoiceNumber',
        ],
        properties: {
          lineNumber: { type: ['number', 'null'] },
          vendorCode: {
            type: ['string', 'null'],
            description: "The vendor's own part/item code for this line, exactly as printed",
          },
          customerCode: {
            type: ['string', 'null'],
            description:
              "The buyer's own part number when the invoice prints one beside the vendor's (Cust P/N, Your ref)",
          },
          description: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], description: 'pcs, kg, m, box, …' },
          unitPriceText: { type: ['string', 'null'], description: 'As printed, with separators' },
          lineTotalText: { type: ['string', 'null'], description: 'As printed. Never computed.' },
          referencedInvoiceNumber: {
            type: ['string', 'null'],
            description:
              'The commercial invoice number THIS line is charged against, when the line names ' +
              'one of its own',
          },
        },
      },
    },
  },
}

/**
 * The instruction that rides in front of the document.
 *
 * The quote prompt's rules, with rule 5 replaced (price breaks do not exist
 * on an invoice; the buyer's own PO number does) and one rule added for
 * `customerCode`.
 */
export const TRANSCRIBE_INVOICE_PROMPT = [
  'You are transcribing a vendor invoice into structured data.',
  '',
  'Rules:',
  '1. Transcribe what is PRINTED. Never calculate, correct, convert or reconcile anything.',
  '2. If the printed grand total does not equal the sum of the lines, copy both as printed.',
  '3. Every money field is a string, copied character for character, including thousands',
  '   separators and currency symbols. Do not turn "1,234.56" into 1234.56.',
  '4. Copy the vendor line code exactly, including case, dashes and leading zeros.',
  "5. If the invoice prints the buyer's purchase order number, copy it exactly as printed",
  '   into purchaseOrderReference.',
  '6. Use null for anything the document does not state. Never invent a value.',
  '7. Include every line, in the order printed, including freight, surcharges and tooling.',
  "8. If the invoice prints the buyer's own part number beside the vendor's code, put it in",
  "   customerCode; the vendor's code stays in vendorCode.",
  '9. Copy a trade discount into discountText as a POSITIVE amount, without its minus sign.',
  "10. A freight or customs invoice often cites the goods supplier's commercial invoice number.",
  '    Copy it into referencedInvoiceNumber - on the line when the line names its own, on the',
  "    document when one covers the whole bill. Never the PO number, never this invoice's own.",
].join('\n')

function toLine(raw: z.infer<typeof lineSchema>): TranscribedInvoiceLine {
  return {
    lineNumber: raw.lineNumber,
    vendorCode: raw.vendorCode,
    customerCode: raw.customerCode,
    description: raw.description,
    quantity: raw.quantity,
    unit: raw.unit,
    unitPriceText: raw.unitPriceText,
    lineTotalText: raw.lineTotalText,
    referencedInvoiceNumber: raw.referencedInvoiceNumber,
  }
}

/**
 * Validate one model response into a {@link TranscribedInvoice}.
 *
 * Throws {@link UnprocessableEntityError} rather than returning a partial: a
 * bill created from half a response is indistinguishable, later, from an
 * invoice whose other half was genuinely blank (§4.2's "the document could
 * not be read" refusal is what a throw here becomes).
 *
 * @param raw The parsed `structured_output`, or `JSON.parse` of the content.
 */
export function parseTranscribedInvoice(raw: unknown): TranscribedInvoice {
  const result = invoiceSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.join('.') || 'response'
    throw new UnprocessableEntityError(
      `The model's transcription did not match the invoice schema (${where}: ${issue?.message ?? 'invalid'})`
    )
  }

  const value = result.data
  return {
    vendorName: value.vendorName,
    vendorEmail: value.vendorEmail,
    vendorAddress: value.vendorAddress,
    invoiceNumber: value.invoiceNumber,
    invoiceDate: value.invoiceDate,
    dueDate: value.dueDate,
    paymentTerms: value.paymentTerms,
    purchaseOrderReference: value.purchaseOrderReference,
    referencedInvoiceNumber: value.referencedInvoiceNumber,
    currency: value.currency ? value.currency.toUpperCase() : null,
    subtotalText: value.subtotalText,
    shippingText: value.shippingText,
    taxText: value.taxText,
    discountText: value.discountText,
    totalText: value.totalText,
    lines: (value.lines ?? []).map(toLine),
  }
}

/** `transcribeInvoice`'s spec: the prompt, the schema and the parser above, booked to `bill_intake`. */
export const INVOICE_TRANSCRIBE_SPEC: TranscribeSpec<TranscribedInvoice> = {
  prompt: TRANSCRIBE_INVOICE_PROMPT,
  schema: TRANSCRIBED_INVOICE_JSON_SCHEMA,
  parse: parseTranscribedInvoice,
  source: 'bill_intake',
}
