// packages/lib/src/money/payments/ledger.ts

import type { PaymentTransactionEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import type {
  DeleteManualPaymentInput,
  RecordManualPaymentInput,
  SyncInvoicePaymentStateInput,
} from '../types'

/**
 * The `PaymentTransaction` ledger service (money MI1 build spec §E.2–§E.4). Functional
 * module (no model class, repo rule) — the ONLY write paths to the ledger table and to the
 * `payment` entity mirror. MP1 adds `createStripeCheckout`/`applyStripeEvent`/
 * `refundTransaction` alongside these, converging on the same `syncTransaction` +
 * `syncInvoicePaymentState` machinery (§E.3 seam) — keep this file free of any `stripe` import.
 */

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Sum succeeded charges minus succeeded refunds for an invoice, in integer cents. */
async function computeAmountPaid(
  organizationId: string,
  invoiceInstanceId: string
): Promise<number> {
  const rows = await database.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId),
      eq(schema.PaymentTransaction.status, 'succeeded')
    ),
    columns: { amount: true, kind: true },
  })
  return rows.reduce((sum, row) => sum + (row.kind === 'refund' ? -row.amount : row.amount), 0)
}

/**
 * Whether any `succeeded` `charge` row exists for an invoice — the void/delete guard
 * (money MI1 build spec §G.4/§G.5, decision 6). Exported so `invoice-lifecycle.ts` can reuse
 * the identical check for both actions.
 */
export async function hasSucceededCharges(
  organizationId: string,
  invoiceInstanceId: string
): Promise<boolean> {
  const row = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId),
      eq(schema.PaymentTransaction.kind, 'charge'),
      eq(schema.PaymentTransaction.status, 'succeeded')
    ),
    columns: { id: true },
  })
  return !!row
}

/**
 * Project the ledger onto an invoice's mirrored `amountPaid`/`balance`/`status` fields
 * (money MI1 build spec §E.4) — the one function where ledger truth becomes invoice state.
 * Writes go through `FieldValueService` (the sanctioned-writer path that structurally
 * bypasses the `rejectManualLifecycleStatus` system pre-hook — the convert-quote.ts:206-210
 * precedent). Only writes fields that actually changed, to avoid no-op event churn.
 */
export async function syncInvoicePaymentState(input: SyncInvoicePaymentStateInput): Promise<void> {
  const { organizationId, userId, invoiceInstanceId } = input
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'invoice_status',
      'invoice_total',
      'invoice_amount_paid',
      'invoice_balance',
    ] as const)

  const fieldIds = [cf.invoice_status, cf.invoice_total, cf.invoice_amount_paid, cf.invoice_balance]
    .filter(Boolean)
    .map((f) => f!.id)
  const values = await handler.getFieldValues(invoiceRecordId, fieldIds)

  const statusTyped = cf.invoice_status ? firstTyped(values.get(cf.invoice_status.id)) : undefined
  const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
  if (status === 'void') return // never touched (§E.4 step 4)

  const totalTyped = cf.invoice_total ? firstTyped(values.get(cf.invoice_total.id)) : undefined
  const total = totalTyped ? (extractValue(totalTyped) as number) : 0
  const currentAmountPaidTyped = cf.invoice_amount_paid
    ? firstTyped(values.get(cf.invoice_amount_paid.id))
    : undefined
  const currentAmountPaid = currentAmountPaidTyped
    ? (extractValue(currentAmountPaidTyped) as number)
    : 0
  const currentBalanceTyped = cf.invoice_balance
    ? firstTyped(values.get(cf.invoice_balance.id))
    : undefined
  const currentBalance = currentBalanceTyped ? (extractValue(currentBalanceTyped) as number) : null

  const amountPaid = await computeAmountPaid(organizationId, invoiceInstanceId)
  const balance = total - amountPaid

  let nextStatus = status
  if (amountPaid >= total && total > 0) {
    nextStatus = 'paid'
  } else if (amountPaid > 0 && amountPaid < total) {
    nextStatus = 'partially_paid'
  } else if (amountPaid <= 0 && (status === 'partially_paid' || status === 'paid')) {
    nextStatus = 'sent'
  }

  const writes: Array<{ fieldId: string; value: unknown }> = []
  if (amountPaid !== currentAmountPaid)
    writes.push({ fieldId: 'invoice_amount_paid', value: amountPaid })
  if (balance !== currentBalance) writes.push({ fieldId: 'invoice_balance', value: balance })
  if (nextStatus !== status) writes.push({ fieldId: 'invoice_status', value: nextStatus })
  if (writes.length === 0) return

  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: invoiceRecordId,
    values: writes,
    publishEvents: true,
  })
}

/**
 * Sync a ledger row onto its `payment` entity mirror, then re-project invoice payment state
 * (money MI1 build spec §E.2). On a `succeeded` `charge` with no `paymentInstanceId` yet,
 * creates the mirror via `UnifiedCrudHandler.create` — the ONLY call that satisfies the
 * `requireLedgerProvenance` system hook (it always passes `payment_transaction_id`) — and
 * stamps `paymentInstanceId` back onto the row. Always ends with `syncInvoicePaymentState`.
 * MP1's webhook transitions call this unchanged — the one converging writer (04-payments).
 */
export async function syncTransaction(params: {
  organizationId: string
  userId: string
  transaction: PaymentTransactionEntity
}): Promise<void> {
  const { organizationId, userId, transaction } = params

  if (
    transaction.status === 'succeeded' &&
    transaction.kind === 'charge' &&
    !transaction.paymentInstanceId
  ) {
    const handler = new UnifiedCrudHandler(organizationId, userId)
    const invoiceRecordId = toRecordId('invoice', transaction.invoiceInstanceId)
    // The ledger row itself has no dedicated "payment date" column — the user-picked date
    // (possibly backdated) rides in `metadata.date`; fall back to the row's createdAt.
    const metadataDate = (transaction.metadata as { date?: string } | null)?.date
    const date = metadataDate ?? transaction.createdAt.toISOString().split('T')[0]

    const created = await handler.create('payment', {
      payment_amount: transaction.amount,
      payment_date: date,
      payment_method: transaction.method ?? 'other',
      payment_reference: transaction.reference ?? undefined,
      payment_note: transaction.note ?? undefined,
      payment_invoice: invoiceRecordId,
      payment_transaction_id: transaction.id,
    })

    await database
      .update(schema.PaymentTransaction)
      .set({ paymentInstanceId: created.instance.id })
      .where(eq(schema.PaymentTransaction.id, transaction.id))
  }

  await syncInvoicePaymentState({
    organizationId,
    userId,
    invoiceInstanceId: transaction.invoiceInstanceId,
  })
}

/**
 * Record a manual (cash/check/card/bank/other) payment against an invoice (money MI1 build
 * spec §E.2, decision 8 — members record payments). Recording on a `draft` invoice is
 * allowed (a cash job never emailed) — `syncInvoicePaymentState` handles the resulting status
 * flip. Inserts a `succeeded` `manual` `charge` row, then syncs.
 */
export async function recordManualPayment(
  input: RecordManualPaymentInput
): Promise<{ transactionId: string }> {
  const { organizationId, userId, invoiceInstanceId, amount, date, method, reference, note } = input
  if (amount <= 0) {
    throw new BadRequestError('Payment amount must be greater than zero')
  }

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_status', 'invoice_total'] as const)
  const fieldIds = [cf.invoice_status, cf.invoice_total].filter(Boolean).map((f) => f!.id)
  const values = await handler.getFieldValues(invoiceRecordId, fieldIds)

  const statusTyped = cf.invoice_status ? firstTyped(values.get(cf.invoice_status.id)) : undefined
  const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
  if (!status) {
    throw new NotFoundError('Invoice not found')
  }
  if (status === 'void') {
    throw new BadRequestError('Cannot record a payment on a void invoice')
  }

  const totalTyped = cf.invoice_total ? firstTyped(values.get(cf.invoice_total.id)) : undefined
  const total = totalTyped ? (extractValue(totalTyped) as number) : 0
  const amountPaid = await computeAmountPaid(organizationId, invoiceInstanceId)
  const balance = total - amountPaid
  if (amount > balance) {
    throw new BadRequestError(`Payment amount exceeds the invoice balance of ${balance}`)
  }

  const currency = (await getOrganizationSetting({
    organizationId,
    key: 'organization.currency',
  })) as string

  const [transaction] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId,
      provider: 'manual',
      kind: 'charge',
      status: 'succeeded',
      amount,
      currency,
      invoiceInstanceId,
      method,
      reference: reference ?? null,
      note: note ?? null,
      createdByUserId: userId,
      metadata: { date },
      updatedAt: new Date(),
    })
    .returning()

  await syncTransaction({ organizationId, userId, transaction: transaction! })

  return { transactionId: transaction!.id }
}

/**
 * Hard-delete a manual ledger row + its `payment` entity mirror (money MI1 build spec §E.2,
 * decision 3 — manual rows are data entry, not money movement, so deleting is honest). Stripe
 * rows are refund-only (MP1) — asserting `provider === 'manual'` here is the MP1-proofing
 * check. Router-gated admin-only (§I.1) — this function itself does not check roles.
 */
export async function deleteManualPayment(input: DeleteManualPaymentInput): Promise<void> {
  const { organizationId, userId, transactionId } = input

  const transaction = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.id, transactionId),
      eq(schema.PaymentTransaction.organizationId, organizationId)
    ),
  })
  if (!transaction) {
    throw new NotFoundError('Payment not found')
  }
  if (transaction.provider !== 'manual') {
    throw new ForbiddenError('Stripe payments can only be refunded')
  }

  const handler = new UnifiedCrudHandler(organizationId, userId)
  if (transaction.paymentInstanceId) {
    await handler.delete(toRecordId('payment', transaction.paymentInstanceId))
  }

  await database
    .delete(schema.PaymentTransaction)
    .where(eq(schema.PaymentTransaction.id, transactionId))

  await syncInvoicePaymentState({
    organizationId,
    userId,
    invoiceInstanceId: transaction.invoiceInstanceId,
  })
}
