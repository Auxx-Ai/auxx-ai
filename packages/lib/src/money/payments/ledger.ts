// packages/lib/src/money/payments/ledger.ts

import type { Database, PaymentTransactionEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
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
import { type DepositForAllocation, planDepositApplication } from './deposit-allocation'

const logger = createScopedLogger('money-ledger')

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
 * Sum succeeded (+ disputed) charge allocations minus refund allocations against an invoice, in
 * integer cents (money 16-deposit-accounting.md §C.1). Reads `PaymentAllocation` joined to its
 * `PaymentTransaction` — allocations, not the transaction's intent `invoiceInstanceId`, are the
 * money-math source of truth now (a held deposit has no allocation yet and correctly contributes
 * 0; a deposit split across two invoices contributes only the slice allocated to THIS one).
 * `disputed` charge rows count alongside `succeeded` ones (money MP1 build spec §E,
 * `charge.dispute.created` bullet) — a dispute flags the row for admin attention but does NOT
 * reduce `amountPaid` until it resolves into an actual refund.
 */
async function computeAmountPaid(
  organizationId: string,
  invoiceInstanceId: string,
  db: Database = database
): Promise<number> {
  const rows = await db
    .select({ amount: schema.PaymentAllocation.amount, kind: schema.PaymentTransaction.kind })
    .from(schema.PaymentAllocation)
    .innerJoin(
      schema.PaymentTransaction,
      eq(schema.PaymentAllocation.paymentTransactionId, schema.PaymentTransaction.id)
    )
    .where(
      and(
        eq(schema.PaymentAllocation.organizationId, organizationId),
        eq(schema.PaymentAllocation.invoiceInstanceId, invoiceInstanceId),
        inArray(schema.PaymentTransaction.status, ['succeeded', 'disputed'])
      )
    )
  return rows.reduce((sum, row) => sum + (row.kind === 'refund' ? -row.amount : row.amount), 0)
}

/**
 * Whether any `succeeded` (or `disputed` — still money-in-flight, MP1) `charge` row is linked to
 * an invoice — the void/delete guard (money MI1 build spec §G.4/§G.5, decision 6; re-pointed at
 * allocations by 16-deposit-accounting.md §C.6). A charge counts if it's either **allocated** to
 * this invoice (the money-math link) OR its intent `invoiceInstanceId` **targets** it (a
 * mid-flight checkout that hasn't been allocated yet) — the union keeps a pending→succeeded race
 * protected: the webhook that inserts the allocation (§C.4) hasn't necessarily landed by the time
 * a concurrent delete request checks this guard. Exported so `invoice-lifecycle.ts` can reuse the
 * identical check for both actions.
 */
export async function hasSucceededCharges(
  organizationId: string,
  invoiceInstanceId: string
): Promise<boolean> {
  const [allocatedRow, intentRow] = await Promise.all([
    database
      .select({ id: schema.PaymentAllocation.id })
      .from(schema.PaymentAllocation)
      .innerJoin(
        schema.PaymentTransaction,
        eq(schema.PaymentAllocation.paymentTransactionId, schema.PaymentTransaction.id)
      )
      .where(
        and(
          eq(schema.PaymentAllocation.organizationId, organizationId),
          eq(schema.PaymentAllocation.invoiceInstanceId, invoiceInstanceId),
          eq(schema.PaymentTransaction.kind, 'charge'),
          inArray(schema.PaymentTransaction.status, ['succeeded', 'disputed'])
        )
      )
      .limit(1),
    database.query.PaymentTransaction.findFirst({
      where: and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId),
        eq(schema.PaymentTransaction.kind, 'charge'),
        inArray(schema.PaymentTransaction.status, ['succeeded', 'disputed'])
      ),
      columns: { id: true },
    }),
  ])
  return allocatedRow.length > 0 || !!intentRow
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
  input: SyncInvoicePaymentStateInput & { db?: Database }
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
  // No `publishEvents` (plan 04 §7.3): the ambient write session decides. On the
  // four Stripe rails these writes are and stay loud; reached from
  // `recomputeInvoiceTotals` during a buffered billing composition they are
  // captured and either absorbed into the invoice's `record:created` (T-1) or
  // replayed post-commit for a pre-existing invoice (the O-8 cross-invoice case).
  await fieldValueService.setValuesForEntity({ recordId: invoiceRecordId, values: writes })
}

/**
 * Sync a ledger row's `PaymentAllocation` rows onto their `payment` entity mirrors, then
 * re-project payment state for every invoice the transaction has allocations against (money
 * 16-deposit-accounting.md §C.3, superseding MI1 build spec §E.2's single-invoice version). For
 * a `succeeded` `charge` transaction, every allocation with no `paymentInstanceId` yet gets its
 * own mirror via `UnifiedCrudHandler.create` — the ONLY call that satisfies the
 * `requireLedgerProvenance` system hook (it always passes `payment_transaction_id`) — and its
 * `paymentInstanceId` stamped back (one mirror PER allocation, not per transaction: a deposit
 * split across two invoices needs two mirrors of the split amounts). Refund transactions never
 * get mirrors (mirrors stay charge-only — refunds render from the ledger row). Ends with
 * `syncInvoicePaymentState` for every DISTINCT invoice among the transaction's allocations.
 *
 * A `succeeded` charge with zero allocations (a still-held deposit) is a clean no-op — same
 * shape as MP2 §B.7, now derived from "no allocation rows" instead of a null `invoiceInstanceId`
 * check.
 */
export async function syncTransaction(params: {
  organizationId: string
  userId: string
  transaction: PaymentTransactionEntity
  db?: Database
}): Promise<void> {
  const { organizationId, userId, transaction } = params
  const db = params.db ?? database

  const allocations = await db.query.PaymentAllocation.findMany({
    where: eq(schema.PaymentAllocation.paymentTransactionId, transaction.id),
  })

  if (transaction.status === 'succeeded' && transaction.kind === 'charge') {
    const handler = new UnifiedCrudHandler(organizationId, userId, db)
    // The ledger row itself has no dedicated "payment date" column — the user-picked date
    // (possibly backdated) rides in `metadata.date`; fall back to the row's createdAt.
    const metadataDate = (transaction.metadata as { date?: string } | null)?.date
    const date = metadataDate ?? transaction.createdAt.toISOString().split('T')[0]

    for (const allocation of allocations) {
      if (allocation.paymentInstanceId) continue
      const invoiceRecordId = toRecordId('invoice', allocation.invoiceInstanceId)
      const created = await handler.create(
        'payment',
        {
          payment_amount: allocation.amount,
          payment_date: date,
          payment_method: transaction.method ?? 'other',
          payment_reference: transaction.reference ?? undefined,
          payment_note: transaction.note ?? undefined,
          payment_invoice: invoiceRecordId,
          payment_transaction_id: transaction.id,
        },
        // T-1b: a payment mirror is STRUCTURAL to the invoice it mirrors onto.
        // When that invoice is being created in the same buffered scope (a
        // deposit settling onto a freshly composed invoice), its single
        // `record:created` announces the mirror too. Inert otherwise — a
        // payment against an existing invoice still announces itself.
        { absorbInto: invoiceRecordId }
      )

      await db
        .update(schema.PaymentAllocation)
        .set({ paymentInstanceId: created.instance.id })
        .where(eq(schema.PaymentAllocation.id, allocation.id))
    }
  }

  const invoiceInstanceIds = [
    ...new Set(allocations.map((allocation) => allocation.invoiceInstanceId)),
  ]
  for (const invoiceInstanceId of invoiceInstanceIds) {
    await syncInvoicePaymentState({ organizationId, userId, invoiceInstanceId, db })
  }
}

/**
 * Apply a work order's succeeded, still-unallocated deposit charge(s) toward an invoice — the
 * partial-aware "apply deposit" operation (money 16-deposit-accounting.md §C.2, replacing MP2
 * §B.6's all-or-nothing stamp). Loads every succeeded `charge` row for this work order with
 * `quoteInstanceId` set (deposit provenance — §J.3 keeps this succeeded-only so a disputed
 * deposit's remainder never allocates), ordered `createdAt` asc, computes each one's unallocated
 * remainder, and feeds them through {@link planDepositApplication} against
 * `invoiceTotal − existing allocations already on this invoice`. Inserts one `PaymentAllocation`
 * row per planned application (`createdByUserId: null` — system/settle-triggered, matching the
 * schema's "null = system" convention) then runs {@link syncTransaction} (the mirror + invoice
 * re-project machinery) once per affected deposit transaction.
 *
 * No `invoiceInstanceId` stamp on the transaction — held-vs-applied is now derived from
 * allocations (`amount − Σallocated > 0` = still held). Self-limiting the same way the old
 * stamp was: a fully-allocated deposit has 0 left and is never picked up again; a
 * PARTIALLY-allocated one correctly offers its remainder to the job's next invoice (the
 * overshoot bug fix). A no-op when the work order has no succeeded deposit, or the invoice has
 * no remaining balance to apply toward.
 */
export async function applyHeldDepositsToInvoice(params: {
  organizationId: string
  userId: string
  workOrderInstanceId: string
  invoiceInstanceId: string
  /** Integer cents — the invoice's current total (0 for a freshly-created, line-less invoice —
   * this call is then a structural no-op, which is correct: there's nothing to apply yet). */
  invoiceTotal: number
  db?: Database
}): Promise<void> {
  const { organizationId, userId, workOrderInstanceId, invoiceInstanceId, invoiceTotal } = params
  const db = params.db ?? database

  const existingAllocationsTotal = await computeAmountPaid(organizationId, invoiceInstanceId, db)
  if (invoiceTotal - existingAllocationsTotal <= 0) return

  const depositCharges = await db.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.workOrderInstanceId, workOrderInstanceId),
      eq(schema.PaymentTransaction.kind, 'charge'),
      eq(schema.PaymentTransaction.status, 'succeeded'),
      isNotNull(schema.PaymentTransaction.quoteInstanceId)
    ),
    orderBy: asc(schema.PaymentTransaction.createdAt),
  })
  if (depositCharges.length === 0) return

  const allocatedRows = await db
    .select({
      paymentTransactionId: schema.PaymentAllocation.paymentTransactionId,
      amount: sql<number>`coalesce(sum(${schema.PaymentAllocation.amount}), 0)::int`,
    })
    .from(schema.PaymentAllocation)
    .where(
      inArray(
        schema.PaymentAllocation.paymentTransactionId,
        depositCharges.map((charge) => charge.id)
      )
    )
    .groupBy(schema.PaymentAllocation.paymentTransactionId)
  const allocatedByTransaction = new Map(
    allocatedRows.map((row) => [row.paymentTransactionId, Number(row.amount)])
  )

  const deposits: DepositForAllocation[] = depositCharges.map((charge) => ({
    id: charge.id,
    amount: charge.amount,
    allocatedTotal: allocatedByTransaction.get(charge.id) ?? 0,
  }))
  const planned = planDepositApplication(deposits, invoiceTotal, existingAllocationsTotal)
  if (planned.length === 0) return

  for (const plan of planned) {
    await db
      .insert(schema.PaymentAllocation)
      .values({
        organizationId,
        paymentTransactionId: plan.transactionId,
        invoiceInstanceId,
        amount: plan.amount,
        createdByUserId: null,
      })
      .onConflictDoNothing()
  }

  const plannedTransactionIds = new Set(planned.map((plan) => plan.transactionId))
  for (const transaction of depositCharges.filter((charge) =>
    plannedTransactionIds.has(charge.id)
  )) {
    await syncTransaction({ organizationId, userId, transaction, db })
  }
}

/** Resolve an invoice's contact instance id via `invoice_contact`, for the ledger's
 * `contactInstanceId` denormalization (money 16-deposit-accounting.md §B/§C.8). Never throws —
 * a resolution failure must not fail the write it's stamping onto; logs a warning and falls
 * back to `null` instead. */
async function resolveInvoiceContactInstanceId(
  organizationId: string,
  handler: UnifiedCrudHandler,
  invoiceRecordId: ReturnType<typeof toRecordId>
): Promise<string | null> {
  try {
    const cf = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['invoice_contact'] as const)
    if (!cf.invoice_contact) return null
    const values = await handler.getFieldValues(invoiceRecordId, [cf.invoice_contact.id])
    const contactTyped = firstTyped(values.get(cf.invoice_contact.id))
    const contactRecordId =
      contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
    return contactRecordId ? parseRecordId(contactRecordId).entityInstanceId : null
  } catch (error) {
    logger.warn('Failed to resolve invoice contact for ledger row', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Record a manual (cash/check/card/bank/other) payment against an invoice (money MI1 build
 * spec §E.2, decision 8 — members record payments). Recording on a `draft` invoice is
 * allowed (a cash job never emailed) — `syncInvoicePaymentState` handles the resulting status
 * flip. Inserts a `succeeded` `manual` `charge` row + its full-amount `PaymentAllocation` (money
 * 16-deposit-accounting.md §C.4 — it's already succeeded at insert time, so the allocation is
 * the same event, not a later settle step), then syncs.
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

  const [currency, contactInstanceId] = await Promise.all([
    getOrganizationSetting({ organizationId, key: 'organization.currency' }) as Promise<string>,
    resolveInvoiceContactInstanceId(organizationId, handler, invoiceRecordId),
  ])

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
      contactInstanceId,
      method,
      reference: reference ?? null,
      note: note ?? null,
      createdByUserId: userId,
      metadata: { date },
      updatedAt: new Date(),
    })
    .returning()

  await database.insert(schema.PaymentAllocation).values({
    organizationId,
    paymentTransactionId: transaction!.id,
    invoiceInstanceId,
    amount,
    createdByUserId: userId,
  })

  await syncTransaction({ organizationId, userId, transaction: transaction! })

  return { transactionId: transaction!.id }
}

/**
 * Hard-delete a manual ledger row + its `payment` entity mirror(s) (money MI1 build spec §E.2,
 * decision 3 — manual rows are data entry, not money movement, so deleting is honest; re-pointed
 * at allocations by 16-deposit-accounting.md §C.6). Stripe rows are refund-only (MP1) —
 * asserting `provider === 'manual'` here is the MP1-proofing check. Collects the row's
 * allocations FIRST (a manual payment has exactly one today, but this stays correct if that ever
 * changes), deletes each allocation's mirror by `paymentInstanceId`, then deletes the
 * transaction itself — `PaymentAllocation.paymentTransactionId` cascades, so the allocation rows
 * go with it — and re-projects every invoice the deleted allocations touched (not just
 * `transaction.invoiceInstanceId!`, which was the intent column, not necessarily where the money
 * actually landed). Router-gated admin-only (§I.1) — this function itself does not check roles.
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

  const allocations = await database.query.PaymentAllocation.findMany({
    where: eq(schema.PaymentAllocation.paymentTransactionId, transactionId),
  })

  const handler = new UnifiedCrudHandler(organizationId, userId)
  for (const allocation of allocations) {
    if (allocation.paymentInstanceId) {
      await handler.delete(toRecordId('payment', allocation.paymentInstanceId))
    }
  }

  await database
    .delete(schema.PaymentTransaction)
    .where(eq(schema.PaymentTransaction.id, transactionId))

  const invoiceInstanceIds = new Set(allocations.map((allocation) => allocation.invoiceInstanceId))
  for (const invoiceInstanceId of invoiceInstanceIds) {
    await syncInvoicePaymentState({ organizationId, userId, invoiceInstanceId })
  }
}
