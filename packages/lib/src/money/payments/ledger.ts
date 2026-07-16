// packages/lib/src/money/payments/ledger.ts

import type { Database, PaymentTransactionEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import { extractRelationshipRecordIds } from '../../field-values/relationship-field'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import type {
  DeleteManualPaymentInput,
  ListWorkOrderPaymentsInput,
  RecordManualPaymentInput,
  SyncInvoicePaymentStateInput,
} from '../types'

/**
 * The `PaymentTransaction` ledger service (money MI1 build spec §E.2–§E.4). Functional
 * module (no model class, repo rule) — the ONLY write paths to the ledger table and to the
 * `payment` entity mirror. `stripe-rail.ts` (money MP1 §E) adds `createStripeCheckout`/
 * `applyStripeEvent`/`refundTransaction` as a sibling, converging on the same `syncTransaction` +
 * `syncInvoicePaymentState` machinery (§E.3 seam) — keep THIS file free of any `stripe` import.
 */

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Sum succeeded charges minus succeeded refunds for an invoice, in integer cents. `disputed`
 * charge rows count alongside `succeeded` ones (money MP1 build spec §E, `charge.dispute.created`
 * bullet) — a dispute flags the row for admin attention but does NOT reduce `amountPaid` until
 * it resolves into an actual refund.
 */
async function computeAmountPaid(
  organizationId: string,
  invoiceInstanceId: string,
  db: Database = database
): Promise<number> {
  const rows = await db.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId),
      inArray(schema.PaymentTransaction.status, ['succeeded', 'disputed'])
    ),
    columns: { amount: true, kind: true },
  })
  return rows.reduce((sum, row) => sum + (row.kind === 'refund' ? -row.amount : row.amount), 0)
}

/**
 * Whether any `succeeded` (or `disputed` — still money-in-flight, MP1) `charge` row exists for
 * an invoice — the void/delete guard (money MI1 build spec §G.4/§G.5, decision 6). Exported so
 * `invoice-lifecycle.ts` can reuse the identical check for both actions.
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
      inArray(schema.PaymentTransaction.status, ['succeeded', 'disputed'])
    ),
    columns: { id: true },
  })
  return !!row
}

/**
 * List every ledger row across ALL invoices linked to a work order, ordered `createdAt` asc
 * (money §A build spec, plans/dispatch/money/10-work-order-billing-tab.md §A) — the
 * cross-invoice read backing the job page's billing section (`listPayments` stays
 * per-invoice, invoice-drawer-only, and is left untouched). Resolves the WO's invoices via the
 * `work_order_invoices` inverse relationship — the same `getFieldValues` +
 * `extractRelationshipRecordIds` mechanism the client's `WorkOrderInvoicesCard` reads
 * (`work-order-related-cards.tsx`), not a new FieldValue query shape.
 *
 * MP2 (§B.9): also matches rows stamped with `workOrderInstanceId` directly — a held deposit
 * charge has no `invoiceInstanceId` yet (it settles onto the job's first invoice, §B.6), so a
 * still-invoice-less job must still surface it here. The invoice-linked branch is only skipped
 * (not the whole query) when the work order has no invoices yet — `inArray` with an empty array
 * is invalid SQL.
 */
export async function listWorkOrderPayments(
  input: ListWorkOrderPaymentsInput
): Promise<PaymentTransactionEntity[]> {
  const { organizationId, userId, workOrderInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const workOrderRecordId = toRecordId('work_order', workOrderInstanceId)

  const woCf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_invoices'] as const)

  let invoiceInstanceIds: string[] = []
  if (woCf.work_order_invoices) {
    const values = await handler.getFieldValues(workOrderRecordId, [woCf.work_order_invoices.id])
    const invoiceRecordIds = extractRelationshipRecordIds(values.get(woCf.work_order_invoices.id))
    invoiceInstanceIds = invoiceRecordIds.map(
      (recordId) => parseRecordId(recordId).entityInstanceId
    )
  }

  return database.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      invoiceInstanceIds.length > 0
        ? or(
            inArray(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceIds),
            eq(schema.PaymentTransaction.workOrderInstanceId, workOrderInstanceId)
          )
        : eq(schema.PaymentTransaction.workOrderInstanceId, workOrderInstanceId)
    ),
    orderBy: asc(schema.PaymentTransaction.createdAt),
  })
}

/**
 * Project the ledger onto an invoice's mirrored `amountPaid`/`balance`/`status` fields
 * (money MI1 build spec §E.4) — the one function where ledger truth becomes invoice state.
 * Writes go through `FieldValueService` (the sanctioned-writer path that structurally
 * bypasses the `rejectManualLifecycleStatus` system pre-hook — the convert-quote.ts:206-210
 * precedent). Only writes fields that actually changed, to avoid no-op event churn.
 */
export async function syncInvoicePaymentState(
  input: SyncInvoicePaymentStateInput & { db?: Database; publishEvents?: boolean }
): Promise<void> {
  const { organizationId, userId, invoiceInstanceId } = input
  const db = input.db ?? database
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId, db)
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

  const amountPaid = await computeAmountPaid(organizationId, invoiceInstanceId, db)
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

  const fieldValueService = new FieldValueService(organizationId, userId, db)
  await fieldValueService.setValuesForEntity({
    recordId: invoiceRecordId,
    values: writes,
    publishEvents: input.publishEvents ?? true,
  })
}

/**
 * Sync a ledger row onto its `payment` entity mirror, then re-project invoice payment state
 * (money MI1 build spec §E.2). On a `succeeded` `charge` with no `paymentInstanceId` yet,
 * creates the mirror via `UnifiedCrudHandler.create` — the ONLY call that satisfies the
 * `requireLedgerProvenance` system hook (it always passes `payment_transaction_id`) — and
 * stamps `paymentInstanceId` back onto the row. Always ends with `syncInvoicePaymentState`.
 * MP1's webhook transitions call this unchanged — the one converging writer (04-payments).
 *
 * MP2 (§B.7): a held deposit charge (`succeeded`, `invoiceInstanceId: null`) is a clean no-op
 * here — the mirror needs an invoice (`payment_invoice` is `nullable: false`) and
 * `syncInvoicePaymentState` needs one to project onto, so both are skipped until
 * `applyHeldDepositToInvoice` stamps the row at settle time and re-calls this function.
 */
export async function syncTransaction(params: {
  organizationId: string
  userId: string
  transaction: PaymentTransactionEntity
  db?: Database
  publishEvents?: boolean
}): Promise<void> {
  const { organizationId, userId, transaction } = params
  const db = params.db ?? database

  if (
    transaction.status === 'succeeded' &&
    transaction.kind === 'charge' &&
    !transaction.paymentInstanceId &&
    transaction.invoiceInstanceId
  ) {
    const handler = new UnifiedCrudHandler(organizationId, userId, db)
    const invoiceRecordId = toRecordId('invoice', transaction.invoiceInstanceId)
    // The ledger row itself has no dedicated "payment date" column — the user-picked date
    // (possibly backdated) rides in `metadata.date`; fall back to the row's createdAt.
    const metadataDate = (transaction.metadata as { date?: string } | null)?.date
    const date = metadataDate ?? transaction.createdAt.toISOString().split('T')[0]

    const created = await handler.create(
      'payment',
      {
        payment_amount: transaction.amount,
        payment_date: date,
        payment_method: transaction.method ?? 'other',
        payment_reference: transaction.reference ?? undefined,
        payment_note: transaction.note ?? undefined,
        payment_invoice: invoiceRecordId,
        payment_transaction_id: transaction.id,
      },
      { skipEvents: params.publishEvents === false }
    )

    await db
      .update(schema.PaymentTransaction)
      .set({ paymentInstanceId: created.instance.id })
      .where(eq(schema.PaymentTransaction.id, transaction.id))
  }

  if (transaction.invoiceInstanceId) {
    await syncInvoicePaymentState({
      organizationId,
      userId,
      invoiceInstanceId: transaction.invoiceInstanceId,
      db,
      publishEvents: params.publishEvents,
    })
  }
}

/**
 * Stamp a held (invoice-less) deposit charge onto the job's first real invoice — the one
 * "apply deposit" operation (money MP2 build spec §B.6). Finds the org's succeeded, still
 * invoice-less `charge` row for this work order, sets its `invoiceInstanceId`, then re-runs
 * `syncTransaction` — which now has both the invoice link AND `succeeded` status, so it takes
 * its normal `payment` mirror + `syncInvoicePaymentState` path. No new settle math.
 *
 * Self-limiting without extra state: once a deposit's `invoiceInstanceId` is stamped, the
 * `isNull(invoiceInstanceId)` filter excludes it from ever being picked up again on the same
 * job's second invoice. A no-op when the work order has no held deposit.
 */
export async function applyHeldDepositToInvoice(params: {
  organizationId: string
  userId: string
  workOrderInstanceId: string
  invoiceInstanceId: string
  db?: Database
  publishEvents?: boolean
}): Promise<void> {
  const { organizationId, userId, workOrderInstanceId, invoiceInstanceId } = params
  const db = params.db ?? database
  const deposit = await db.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.workOrderInstanceId, workOrderInstanceId),
      eq(schema.PaymentTransaction.kind, 'charge'),
      eq(schema.PaymentTransaction.status, 'succeeded'),
      isNull(schema.PaymentTransaction.invoiceInstanceId)
    ),
  })
  if (!deposit) return
  const [updated] = await db
    .update(schema.PaymentTransaction)
    .set({ invoiceInstanceId })
    .where(eq(schema.PaymentTransaction.id, deposit.id))
    .returning()
  await syncTransaction({
    organizationId,
    userId,
    transaction: updated!,
    db,
    publishEvents: params.publishEvents,
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
    invoiceInstanceId: transaction.invoiceInstanceId!,
  })
}
