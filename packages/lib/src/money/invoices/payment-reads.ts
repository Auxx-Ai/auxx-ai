// packages/lib/src/money/invoices/payment-reads.ts

/**
 * Payments recorded against an invoice, read from the MONEY model
 * (plans/accounting/tasks/54-one-money-model.md unit 2b).
 *
 * The read half of `record-payment.ts`, and the reason it exists at once rather
 * than later: repointing the write door without this leaves a payment that was
 * recorded successfully and then does not appear anywhere, because the invoice
 * drawer's list reads `PaymentTransaction`.
 *
 * ## ⚠️ `provider: 'money'` is load-bearing in the UI
 *
 * `payments-list.tsx` keys its actions off it: a `money` row offers **Void**
 * (`voidInvoicePayment`, a reversing correction) where a legacy `manual` row
 * offers Delete, and neither offers the Stripe rail's Refund. The distinction
 * has to survive into the row because an immutable, hashed effect cannot be
 * deleted the way a `PaymentTransaction` could — the router routes on the id
 * and the two lanes never share one.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'

/** One recorded payment, shaped for the invoice drawer's existing row contract. */
export interface InvoicePaymentRow {
  id: string
  amount: number
  kind: 'charge'
  status: 'succeeded'
  /** `YYYY-MM-DD` — the day the money was received, whichever precision it carries. */
  date: string
  method: string | null
  reference: string | null
  note: string | null
  provider: 'money'
  /** How much of this receipt is applied to THIS invoice. */
  allocatedAmount: number
}

/**
 * Every money-model receipt applied to one invoice, oldest first.
 *
 * 🛑 Nets `unapply` against `apply` rather than listing raw rows: a receipt
 * moved off this invoice and onto another still has its `apply` row — the pair
 * is the record — and showing it as money on this invoice would overstate what
 * the customer has paid. A fully unapplied receipt drops out entirely.
 */
export async function listInvoiceMoneyPayments(
  db: Database | Transaction,
  params: { organizationId: string; invoiceInstanceId: string }
): Promise<InvoicePaymentRow[]> {
  const { organizationId, invoiceInstanceId } = params

  const applications = await db
    .select({
      amountMinor: schema.MoneyApplication.amountMinor,
      operation: schema.MoneyApplication.operation,
      moneyTransactionId: schema.MoneyApplication.moneyTransactionId,
      createdAt: schema.MoneyApplication.createdAt,
      purpose: schema.MoneyTransaction.purpose,
      occurredAt: schema.MoneyTransaction.occurredAt,
      occurredOn: schema.MoneyTransaction.occurredOn,
      method: schema.MoneyTransaction.method,
      reference: schema.MoneyTransaction.reference,
      note: schema.MoneyTransaction.note,
    })
    .from(schema.MoneyApplication)
    .innerJoin(
      schema.MoneyTransaction,
      and(
        eq(schema.MoneyTransaction.organizationId, schema.MoneyApplication.organizationId),
        eq(schema.MoneyTransaction.id, schema.MoneyApplication.moneyTransactionId)
      )
    )
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt')
      )
    )
    .orderBy(asc(schema.MoneyApplication.createdAt))

  const byTransaction = new Map<string, InvoicePaymentRow>()
  for (const row of applications) {
    const signed = row.operation === 'apply' ? row.amountMinor : -row.amountMinor
    const existing = byTransaction.get(row.moneyTransactionId)
    if (existing) {
      existing.allocatedAmount += Number(signed)
      continue
    }
    byTransaction.set(row.moneyTransactionId, {
      id: row.moneyTransactionId,
      amount: Number(signed),
      kind: 'charge',
      status: 'succeeded',
      // A date-precision receipt already IS its day; an instant is trimmed to
      // one. The drawer shows a day either way.
      date: row.occurredOn ?? row.occurredAt?.toISOString().split('T')[0] ?? '',
      method: row.method,
      reference: row.reference,
      note: row.note,
      provider: 'money',
      allocatedAmount: Number(signed),
    })
  }
  return [...byTransaction.values()]
    .filter((row) => row.allocatedAmount > 0)
    .map((row) => ({ ...row, amount: row.allocatedAmount }))
}
