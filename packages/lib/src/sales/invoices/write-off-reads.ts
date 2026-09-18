// packages/lib/src/sales/invoices/write-off-reads.ts
//
// The read half of the invoice WRITE-OFF entry, split out of `write-off.ts` so
// the domain writer and the accounting-effect path can share one loader without
// importing each other (`docs/lib-module-guide.md` §5) - the same split
// `issuance-reads.ts` makes for the issuance entry.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { WRITE_OFF_SOURCE_TYPE } from '../../accounting/ledger/builders/write-off'
import { getOrgCache } from '../../cache'

const INVOICE_ATTRIBUTES = [
  'invoice_status',
  'invoice_number',
  'invoice_balance',
  'invoice_total',
  'invoice_amount_paid',
  'invoice_written_off',
  'invoice_contact',
] as const

/** The invoice values a write-off is decided and built from. Nothing else is read. */
export interface InvoiceForWriteOff {
  status: string
  number: string
  /** Integer minor units. `0` when the field has never been written. */
  balanceMinor: number
  /** Integer minor units. `0` when the field has never been written. */
  totalMinor: number
  /** Integer minor units. `0` when the field has never been written. */
  amountPaidMinor: number
  /**
   * Cumulative bad debt already taken off this invoice, integer minor units.
   * `0` on an org that has not run entity migration 128 yet, which is also the
   * right answer there: nothing has been written off through a path that could
   * have recorded it.
   */
  writtenOffMinor: number
  /**
   * Whether this org has the `invoice_written_off` field at all - it arrives
   * with entity migration 128, and an org short of it must not be handed a
   * write for a field that does not exist.
   */
  hasWrittenOffField: boolean
  /**
   * What is still sitting in accounts receivable for this invoice, and so the
   * most that may still be written off. See {@link resolveOutstandingMinor}.
   */
  outstandingMinor: number
  /** `invoice_contact`'s related `contact` instance id, for the receivable's counterparty. */
  contactInstanceId: string | null
}

/**
 * The receivable this invoice still carries: `total - amountPaid - writtenOff`.
 *
 * 🛑 **Derived from the totals rather than read off `invoice_balance`, because
 * two writers disagree about that field.** `syncInvoicePaymentState`
 * (`money/payments/ledger.ts`) recomputes it as `total - amountPaid` on every
 * payment event and knows nothing about bad debt, so the reduction a partial
 * write-off makes to it is undone by the next payment sync. Deriving here is
 * stable under that: `writtenOff` only ever grows, and it is never folded into
 * the two numbers it is subtracted from.
 *
 * ⚠️ The fallback, for an invoice with no `total` written yet, is
 * `invoice_balance` verbatim - what this file used before. It cannot subtract
 * `writtenOff` there without double-counting, because with no total nothing
 * re-derives the balance and the reduction this file made to it still stands.
 * An invoice with no total is degenerate anyway: `syncInvoicePaymentState`
 * would compute a negative balance for it.
 */
export function resolveOutstandingMinor(parts: {
  totalMinor: number
  amountPaidMinor: number
  writtenOffMinor: number
  balanceMinor: number
}): number {
  const { totalMinor, amountPaidMinor, writtenOffMinor, balanceMinor } = parts
  if (totalMinor > 0) {
    return Math.max(0, totalMinor - amountPaidMinor - writtenOffMinor)
  }
  return Math.max(0, balanceMinor)
}

/**
 * The invoice's status/number/balance, or `null` when it does not exist. A
 * plain `FieldValue` read - no actor needed, so `previewWriteOffInvoice`,
 * `writeOffInvoice` and the acceptance revalidator share it without any of them
 * having to invent one, unlike `UnifiedCrudHandler.getFieldValues`.
 */
export async function loadInvoiceForWriteOff(
  db: Database | Transaction,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceForWriteOff | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...INVOICE_ATTRIBUTES])
  const fieldIds = [
    cf.invoice_status,
    cf.invoice_number,
    cf.invoice_balance,
    cf.invoice_total,
    cf.invoice_amount_paid,
    cf.invoice_written_off,
    cf.invoice_contact,
  ]
    .filter((f) => f !== null)
    .map((f) => f.id)
  if (fieldIds.length === 0) return null

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, invoiceId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
  const byField = new Map(rows.map((row) => [row.fieldId, row]))

  const status = cf.invoice_status ? byField.get(cf.invoice_status.id)?.optionId : undefined
  if (!status) return null

  const number = (cf.invoice_number ? byField.get(cf.invoice_number.id)?.valueText : null) ?? ''
  const numberOf = (field: { id: string } | null): number =>
    (field ? byField.get(field.id)?.valueNumber : null) ?? 0

  const balanceMinor = numberOf(cf.invoice_balance)
  const totalMinor = numberOf(cf.invoice_total)
  const amountPaidMinor = numberOf(cf.invoice_amount_paid)
  const writtenOffMinor = numberOf(cf.invoice_written_off)

  return {
    status,
    number,
    balanceMinor,
    totalMinor,
    amountPaidMinor,
    writtenOffMinor,
    hasWrittenOffField: cf.invoice_written_off !== null,
    outstandingMinor: resolveOutstandingMinor({
      totalMinor,
      amountPaidMinor,
      writtenOffMinor,
      balanceMinor,
    }),
    contactInstanceId:
      (cf.invoice_contact ? byField.get(cf.invoice_contact.id)?.relatedEntityId : null) ?? null,
  }
}

/**
 * How many `write_off` postings this invoice has already produced - the
 * `attempt` `buildWriteOffEntry` keys on, and the OCCURRENCE its accounting
 * work is keyed on (`documentAccountingEffectKey`).
 *
 * 🛑 Counted off `GlPostingLine`'s `sourceType`/`sourceId` pair, filtered to the
 * `write_off` posting type, and never off a mirrored column on the invoice: a
 * mirror holds only the latest posting and a reversal clears it, so the count
 * would fall back to zero and the next write-off would re-claim the reversed
 * original's period tuple. The `write_off` filter is what the bank line's
 * equivalent does not need: `sourceType` is `invoice`, which the payment and
 * invoice-issuance entries also carry, so counting without it would inflate the
 * attempt by every other entry the invoice has ever produced.
 */
export async function countWriteOffPostings(
  db: Database | Transaction,
  organizationId: string,
  invoiceId: string
): Promise<number> {
  const rows = await db
    .selectDistinct({ glPostingId: schema.GlPosting.id })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'write_off'),
        eq(schema.GlPostingLine.sourceType, WRITE_OFF_SOURCE_TYPE),
        eq(schema.GlPostingLine.sourceId, invoiceId)
      )
    )
  return rows.length
}
