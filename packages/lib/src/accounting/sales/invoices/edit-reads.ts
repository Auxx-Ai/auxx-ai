// packages/lib/src/accounting/sales/invoices/edit-reads.ts
//
// What the edit-in-place lane needs to decide whether an invoice may be opened
// and how far Save may take its total down (74 §1.3). The build half is
// `issuance-reads.ts`; this is the header and the floor.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { NotFoundError } from '../../../errors'
import { systemFieldMap } from '../../../resources/system-records'
import { listInvoiceMoneyPayments } from '../../money/invoice-payments/payment-reads'
import { sumInvoiceCreditApplications } from '../credit-memos/reads'

const INVOICE_ATTRIBUTES = ['invoice_status', 'invoice_number', 'invoice_total'] as const

export interface InvoiceForEdit {
  id: string
  /** `invoice_status` — `draft`, `sent`, `partially_paid`, `paid`, `void`, `written_off`. */
  status: string
  /** OURS, and what the issuance entry keys its document number on. */
  number: string
  /** Integer minor units. */
  totalMinor: number
  /** Integer minor units, applied receipts netted of unapplies. */
  amountPaidMinor: number
  /** Integer minor units, credit-memo shares applied to this invoice. */
  amountCreditedMinor: number
}

/**
 * The invoice's header and what has been settled against it.
 *
 * 🛑 Paid and credited are read from the MONEY MODEL, not from
 * `invoice_amount_paid` / `invoice_amount_credited` — the same two sums
 * `syncInvoicePaymentState` projects those fields from, and the same source
 * `voidInvoice` refuses on. Reading the projection would floor Save on a mirror
 * that a failed sync can leave stale.
 */
export async function loadInvoiceForEdit(
  db: Database | Transaction,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceForEdit> {
  const cf = await systemFieldMap(db, organizationId, [...INVOICE_ATTRIBUTES])
  const fields = [cf.invoice_status, cf.invoice_number, cf.invoice_total].filter(
    (field) => field !== null
  )
  if (fields.length === 0) throw new NotFoundError(`Invoice ${invoiceId} has no readable fields`)

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
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

  const status = cf.invoice_status ? byField.get(cf.invoice_status.id)?.optionId : null
  if (!status) throw new NotFoundError(`Invoice ${invoiceId} has no status`)

  const [payments, amountCreditedMinor] = await Promise.all([
    listInvoiceMoneyPayments(db, { organizationId, invoiceInstanceId: invoiceId }),
    sumInvoiceCreditApplications(db, organizationId, invoiceId),
  ])

  return {
    id: invoiceId,
    status,
    number: (cf.invoice_number ? byField.get(cf.invoice_number.id)?.valueText : null) ?? '',
    totalMinor: (cf.invoice_total ? byField.get(cf.invoice_total.id)?.valueNumber : null) ?? 0,
    amountPaidMinor: payments.reduce((sum, row) => sum + row.allocatedAmount, 0),
    amountCreditedMinor,
  }
}
