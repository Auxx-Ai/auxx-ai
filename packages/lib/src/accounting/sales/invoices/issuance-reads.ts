// packages/lib/src/accounting/sales/invoices/issuance-reads.ts
//
// The read half of the invoice ISSUANCE entry, split out of `post-invoice.ts`
// so the write path and the accounting-effect path can share one loader without
// importing each other (`docs/lib-module-guide.md` §5).

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'

const INVOICE_ATTRIBUTES = [
  'invoice_number',
  'invoice_issued_at',
  'invoice_subtotal',
  'invoice_tax_total',
  'invoice_total',
  'invoice_contact',
] as const

/** The invoice values an issuance entry is built from. Nothing else is read. */
export interface InvoiceForIssuance {
  number: string
  /** `YYYY-MM-DD`, or `null` when nothing has been stamped. */
  issuedAt: string | null
  subtotalMinor: number | null
  taxTotalMinor: number | null
  totalMinor: number | null
  /** `invoice_contact`'s related `contact` instance id, for the receivable's counterparty. */
  contactInstanceId: string | null
}

/**
 * Read the five values off `FieldValue` directly.
 *
 * A plain read rather than `UnifiedCrudHandler.getFieldValues`, which needs an
 * actor - the same trade `write-off.ts` makes so its preview and its writer can
 * share one loader.
 */
export async function loadInvoiceForIssuance(
  db: Database | Transaction,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceForIssuance | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...INVOICE_ATTRIBUTES])
  const fields = [
    cf.invoice_number,
    cf.invoice_issued_at,
    cf.invoice_subtotal,
    cf.invoice_tax_total,
    cf.invoice_total,
    cf.invoice_contact,
  ].filter((field) => field !== null)
  if (fields.length === 0) return null

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, invoiceId),
        inArray(
          schema.FieldValue.fieldId,
          fields.map((field) => field.id)
        )
      )
    )
  const byField = new Map(rows.map((row) => [row.fieldId, row]))

  const number = (cf.invoice_number ? byField.get(cf.invoice_number.id)?.valueText : null) ?? ''
  // `FieldValue.valueDate` arrives as an ISO instant; the accounting date is
  // the calendar day the bookkeeper wrote, so it is sliced, never re-zoned.
  const rawIssuedAt = cf.invoice_issued_at ? byField.get(cf.invoice_issued_at.id)?.valueDate : null
  const issuedAt =
    typeof rawIssuedAt === 'string' && rawIssuedAt.length >= 10 ? rawIssuedAt.slice(0, 10) : null

  return {
    number,
    issuedAt,
    subtotalMinor:
      (cf.invoice_subtotal ? byField.get(cf.invoice_subtotal.id)?.valueNumber : null) ?? null,
    taxTotalMinor:
      (cf.invoice_tax_total ? byField.get(cf.invoice_tax_total.id)?.valueNumber : null) ?? null,
    totalMinor: (cf.invoice_total ? byField.get(cf.invoice_total.id)?.valueNumber : null) ?? null,
    contactInstanceId:
      (cf.invoice_contact ? byField.get(cf.invoice_contact.id)?.relatedEntityId : null) ?? null,
  }
}
