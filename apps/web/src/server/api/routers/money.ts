// apps/web/src/server/api/routers/money.ts

import type { PaymentTransactionEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { conditionGroupsSchema } from '@auxx/lib/conditions'
import { renderPreviewQuotePdf } from '@auxx/lib/documents'
import { NotFoundError } from '@auxx/lib/errors'
import {
  addVisitExtrasToContract,
  approveQuote,
  clearInvoiceSchedule,
  convertQuoteToWorkOrder,
  createExtraWorkInvoice,
  createFixedContractInvoice,
  createQuoteFromRequest,
  createRecurringCharge,
  createVisitInvoice,
  declineQuote,
  deleteInvoice,
  deleteInvoiceLine,
  deleteManualPayment,
  disconnectPaymentAccount,
  ensureQuoteDocumentPdf,
  getAllocationTotalsByTransaction,
  getContactBillingOverview,
  getInvoiceSchedule,
  getPaymentAccount,
  getWorkOrderBillingState,
  listWorkOrderPayments,
  markInvoiceSent,
  markQuoteSent,
  prepareDocumentEmail,
  previewInvoiceBatch,
  recomputeTotals,
  recordManualPayment,
  refundTransaction,
  reorderLines,
  runInvoiceBatch,
  saveBillingInstallments,
  setInvoiceSchedule,
  syncAccountState,
  syncInvoiceToQuickbooks,
  voidInvoice,
} from '@auxx/lib/money'
import { FeaturePermissionService, getCapabilities, PermissionKey } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  describeRecurrence,
  type RecurrencePattern,
  recurrencePatternSchema,
} from '@auxx/lib/recurrence'
import { getOrganizationSetting } from '@auxx/lib/settings'
import { parseRecordId, recordIdSchema, toRecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * protectedProcedure + the `dispatch` feature gate — money gates on dispatch (README). Layers
 * the `dispatch.board.manage` capability (§9): money WRITES are desk work full members do (they
 * hold the key by default), while field (worker) seats — who hold neither board key — 403.
 * Attaches the resolved `CapabilitySet` as `ctx.capabilities`. Read surfaces use
 * {@link moneyViewProcedure} instead.
 */
const moneyProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.dispatch
  )
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchBoardManage)
  return next({ ctx: { capabilities } })
})

/** {@link moneyProcedure}'s feature gate + the `dispatch.board.view` capability — money READ
 * surfaces (billing state, payment lists, schedule). Full members hold the view key; field
 * seats do not. */
const moneyViewProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.dispatch
  )
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchBoardView)
  return next({ ctx: { capabilities } })
})

/**
 * protectedProcedure + the same `dispatch` feature gate as {@link moneyProcedure} — for the
 * money mutations that are destructive corrections or account-level writes, not desk work:
 * manual `deletePayment` (money MI1 build spec §I.1, decision 8), and the Stripe Connect
 * `refundTransaction`/`syncAccountState`/`disconnectPayments` (money MP1 build spec §L). Layers
 * the `dispatch.board.manage` capability + attaches `ctx.capabilities`.
 */
const moneyAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.dispatch
  )
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchBoardManage)
  return next({ ctx: { capabilities } })
})

/**
 * Shape a `PaymentTransaction` ledger row for the payments list UI (money MI1 build spec
 * §E.2 row shape) — shared by `listPayments` (per-invoice, invoice-drawer),
 * `listPaymentsForWorkOrder` (cross-invoice, job page), and `listPaymentsForQuote` (quote
 * drawer deposit card) so the row shape can't drift between call sites.
 * `invoiceInstanceId`/`quoteInstanceId`/`workOrderInstanceId` (money MP2 §B.9) let the client
 * tell a "held" deposit (`invoiceInstanceId === null`) apart from an "applied" one.
 *
 * `allocatedAmount` (deposit-accounting plan 16 §D.3) is server-computed by the caller (batched
 * via `getAllocationTotalsByTransaction` — never a per-row query) and passed in rather than
 * read here, so every call site is forced to prove it isn't N+1-ing. `heldAmount` is derived:
 * `max(0, amount - allocatedAmount)` for a succeeded charge (the only rows a deposit can still
 * be "held" on), `0` for anything else (refunds, pending/failed/canceled/disputed charges) —
 * `isDeposit` (`quoteInstanceId != null`) is left for the client to derive, same as today.
 */
function mapPaymentRow(row: PaymentTransactionEntity, allocatedAmount: number) {
  const heldAmount =
    row.kind === 'charge' && row.status === 'succeeded'
      ? Math.max(0, row.amount - allocatedAmount)
      : 0
  return {
    id: row.id,
    amount: row.amount,
    kind: row.kind,
    status: row.status,
    date: (row.metadata as { date?: string } | null)?.date ?? row.createdAt.toISOString(),
    method: row.method,
    reference: row.reference,
    note: row.note,
    provider: row.provider,
    createdByUserId: row.createdByUserId,
    stripeRefundId: row.stripeRefundId,
    refundedTransactionId: row.refundedTransactionId,
    invoiceInstanceId: row.invoiceInstanceId,
    quoteInstanceId: row.quoteInstanceId,
    workOrderInstanceId: row.workOrderInstanceId,
    allocatedAmount,
    heldAmount,
  }
}

/** Batch-map a list of ledger rows through {@link mapPaymentRow}, fetching every row's
 * allocation total in one query (`getAllocationTotalsByTransaction`) instead of per row. */
async function mapPaymentRows(organizationId: string, rows: PaymentTransactionEntity[]) {
  const allocationTotals = await getAllocationTotalsByTransaction(
    organizationId,
    rows.map((row) => row.id)
  )
  return rows.map((row) => mapPaymentRow(row, allocationTotals.get(row.id) ?? 0))
}

export const moneyRouter = createTRPCRouter({
  createQuoteFromRequest: moneyProcedure
    .input(z.object({ requestRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.requestRecordId)
      return createQuoteFromRequest({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        requestInstanceId: entityInstanceId,
      })
    }),

  markQuoteSent: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return markQuoteSent({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  approveQuote: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return approveQuote({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  declineQuote: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return declineQuote({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  convertQuoteToWorkOrder: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return convertQuoteToWorkOrder({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  reorderLines: moneyProcedure
    .input(
      z.object({
        documentRecordId: recordIdSchema.optional(),
        orderedLineRecordIds: z.array(recordIdSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return reorderLines({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        documentRecordId: input.documentRecordId,
        orderedLineInstanceIds: input.orderedLineRecordIds.map(
          (recordId) => parseRecordId(recordId).entityInstanceId
        ),
      })
    }),

  recomputeTotals: moneyProcedure
    .input(
      z
        .object({
          /** @deprecated legacy shape — pass `recordId` instead (quote or invoice). */
          quoteRecordId: recordIdSchema.optional(),
          /** Quote, invoice or order RecordId (money MI1 build spec §I.2, widened to
           * `order` by plans/products/08-order-build.md §5.6) — `documentType` is derived
           * from the def component, no separate flag needed. */
          recordId: recordIdSchema.optional(),
        })
        .refine((val) => Boolean(val.quoteRecordId) !== Boolean(val.recordId), {
          message: 'Provide exactly one of quoteRecordId or recordId',
        })
    )
    .mutation(async ({ ctx, input }) => {
      const targetRecordId = (input.recordId ?? input.quoteRecordId)!
      const { entityDefinitionId, entityInstanceId } = parseRecordId(targetRecordId)
      // Membership test, not a two-way ternary: the old
      // `=== 'invoice' ? 'invoice' : 'quote'` shape would have silently
      // recomputed an ORDER as a quote, writing quote_* totals onto it
      // (plans/products/08-order-build.md §5.6, the billingPrefix trap).
      const documentType =
        entityDefinitionId === 'invoice' || entityDefinitionId === 'order'
          ? entityDefinitionId
          : 'quote'
      return recomputeTotals({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        documentType,
        documentInstanceId: entityInstanceId,
      })
    }),

  // ─── Invoicing (money MI1 build spec §I.2) ──────────────────────────────

  getWorkOrderBillingState: moneyViewProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId: workOrderInstanceId } = parseRecordId(input.workOrderRecordId)
      return getWorkOrderBillingState({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId,
      })
    }),

  getContactBillingOverview: moneyViewProcedure
    .input(z.object({ contactRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId: contactInstanceId } = parseRecordId(input.contactRecordId)
      return getContactBillingOverview({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        contactInstanceId,
      })
    }),

  createFixedContractInvoice: moneyProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        amount: z.discriminatedUnion('type', [
          z.object({ type: z.literal('remaining') }),
          z.object({ type: z.literal('percentage'), value: z.number().positive().max(100) }),
          z.object({ type: z.literal('fixed'), amount: z.number().int().positive() }),
          z.object({ type: z.literal('installment'), installmentId: z.string().min(1) }),
        ]),
      })
    )
    .mutation(async ({ ctx, input }) =>
      createFixedContractInvoice({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: parseRecordId(input.workOrderRecordId).entityInstanceId,
        amount: input.amount,
      })
    ),

  createVisitInvoice: moneyProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema, visitIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) =>
      createVisitInvoice({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: parseRecordId(input.workOrderRecordId).entityInstanceId,
        visitIds: input.visitIds,
      })
    ),

  createRecurringCharge: moneyProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema, occurrenceDate: z.string().optional() }))
    .mutation(async ({ ctx, input }) =>
      createRecurringCharge({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: parseRecordId(input.workOrderRecordId).entityInstanceId,
        occurrenceDate: input.occurrenceDate,
      })
    ),

  createExtraWorkInvoice: moneyProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        visitIds: z.array(z.string()).min(1),
        sourceLineIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      createExtraWorkInvoice({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: parseRecordId(input.workOrderRecordId).entityInstanceId,
        visitIds: input.visitIds,
        sourceLineIds: input.sourceLineIds,
      })
    ),

  addVisitExtrasToContract: moneyProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema, visitId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) =>
      addVisitExtrasToContract({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: parseRecordId(input.workOrderRecordId).entityInstanceId,
        visitId: input.visitId,
      })
    ),

  // ─── Batch advance invoicing (plans/dispatch/37a-batch-advance-invoicing.md) ────

  previewInvoiceBatch: moneyViewProcedure
    .input(
      z.object({
        range: z.object({ from: z.date(), to: z.date() }),
        filters: conditionGroupsSchema,
      })
    )
    .query(async ({ ctx, input }) =>
      previewInvoiceBatch({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        range: input.range,
        filters: input.filters,
      })
    ),

  runInvoiceBatch: moneyProcedure
    .input(
      z.object({
        range: z.object({ from: z.date(), to: z.date() }),
        workOrderRecordIds: z.array(recordIdSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) =>
      runInvoiceBatch({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        range: input.range,
        workOrderRecordIds: input.workOrderRecordIds,
      })
    ),

  saveBillingInstallments: moneyAdminProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        installments: z.array(
          z.object({
            name: z.string().trim().min(1),
            calculation: z.enum(['percentage', 'fixed']),
            percentageBasisPoints: z.number().int().positive().max(10_000).optional(),
            amount: z.number().int().positive().optional(),
            trigger: z.enum(['manual', 'date', 'work_order_completion']),
            scheduledDate: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) =>
      saveBillingInstallments({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: parseRecordId(input.workOrderRecordId).entityInstanceId,
        installments: input.installments,
      })
    ),

  markInvoiceSent: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return markInvoiceSent({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
      })
    }),

  // Manual "Sync to QuickBooks" action (plans/dispatch/37e-quickbooks-invoice-sync.md §3, P3) —
  // calls the orchestrator directly (not via the queue) so the UI gets the result inline; the
  // draft→sent field-change hook (`enqueueQuickbooksInvoiceSyncOnSent`) uses the same
  // orchestrator through the queue for the automatic path.
  syncInvoiceToQuickbooks: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return syncInvoiceToQuickbooks({
        organizationId: ctx.session.organizationId,
        invoiceInstanceId: entityInstanceId,
        actorUserId: ctx.session.user.id,
      })
    }),

  voidInvoice: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return voidInvoice({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
      })
    }),

  deleteInvoice: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return deleteInvoice({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
      })
    }),

  deleteInvoiceLine: moneyProcedure
    .input(z.object({ lineRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.lineRecordId)
      return deleteInvoiceLine({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        lineInstanceId: entityInstanceId,
      })
    }),

  // ─── Invoice automation — billing schedule (money MI2 build spec §J) ────
  // Deliberately member-level (`moneyProcedure`), NOT admin-gated like M2c's dispatch
  // recurrence procedures — configuring a job's billing cadence is desk work, same tier as
  // recording a payment (MI1 decision 8's spirit), not an account-level/destructive action.

  setInvoiceSchedule: moneyProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        pattern: recurrencePatternSchema,
        timezone: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId: workOrderInstanceId } = parseRecordId(input.workOrderRecordId)
      return setInvoiceSchedule({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId,
        pattern: input.pattern,
        timezone: input.timezone,
      })
    }),

  clearInvoiceSchedule: moneyProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId: workOrderInstanceId } = parseRecordId(input.workOrderRecordId)
      return clearInvoiceSchedule({
        organizationId: ctx.session.organizationId,
        workOrderInstanceId,
      })
    }),

  getInvoiceSchedule: moneyViewProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId: workOrderInstanceId } = parseRecordId(input.workOrderRecordId)
      const rule = await getInvoiceSchedule({
        organizationId: ctx.session.organizationId,
        workOrderInstanceId,
      })
      if (!rule) return null

      const weekStart = (await getOrganizationSetting({
        organizationId: ctx.session.organizationId,
        key: 'organization.weekStart',
      })) as 'monday' | 'sunday' | 'saturday'

      return {
        pattern: rule.pattern,
        timezone: rule.timezone,
        materializedUntil: rule.materializedUntil,
        summary: describeRecurrence(rule.pattern as unknown as RecurrencePattern, {
          weekStart: weekStart ?? 'monday',
        }),
      }
    }),

  recordPayment: moneyProcedure
    .input(
      z.object({
        invoiceRecordId: recordIdSchema,
        /** Integer cents (the MQ1 convention) — the dialog converts at the edge. */
        amount: z.number().int().positive(),
        /** ISO date string (`yyyy-MM-dd`) — the date the payment was made (may be backdated). */
        date: z.string(),
        method: z.enum(['cash', 'check', 'card', 'bank', 'other']),
        reference: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return recordManualPayment({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
        amount: input.amount,
        date: input.date,
        method: input.method,
        reference: input.reference,
        note: input.note,
      })
    }),

  deletePayment: moneyAdminProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deleteManualPayment({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        transactionId: input.transactionId,
      })
    }),

  refundTransaction: moneyAdminProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return refundTransaction({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        transactionId: input.transactionId,
      })
    }),

  // ─── Stripe Connect payment collection (money MP1 build spec §L) ───────

  getPaymentAccount: moneyViewProcedure.query(async ({ ctx }) => {
    const account = await getPaymentAccount(ctx.session.organizationId)
    if (!account) return null
    return {
      stripeAccountId: account.stripeAccountId,
      credentialId: account.credentialId,
      chargesEnabled: account.chargesEnabled,
      detailsSubmitted: account.detailsSubmitted,
      defaultCurrency: account.defaultCurrency,
      applicationFeePercent: account.applicationFeePercent,
      disconnectedAt: account.disconnectedAt,
    }
  }),

  syncAccountState: moneyAdminProcedure.mutation(async ({ ctx }) => {
    const account = await getPaymentAccount(ctx.session.organizationId)
    if (!account?.stripeAccountId) {
      throw new NotFoundError('No Stripe account connected for this organization')
    }
    return syncAccountState(ctx.session.organizationId, account.stripeAccountId)
  }),

  disconnectPayments: moneyAdminProcedure.mutation(async ({ ctx }) => {
    return disconnectPaymentAccount(ctx.session.organizationId)
  }),

  listPayments: moneyViewProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      const rows = await database.query.PaymentTransaction.findMany({
        where: and(
          eq(schema.PaymentTransaction.organizationId, ctx.session.organizationId),
          eq(schema.PaymentTransaction.invoiceInstanceId, entityInstanceId)
        ),
        orderBy: asc(schema.PaymentTransaction.createdAt),
      })

      return mapPaymentRows(ctx.session.organizationId, rows)
    }),

  /**
   * Cross-invoice payments read for the job page's billing section (money work-order billing
   * tab build spec §A) — every ledger row across ALL of a work order's invoices, `createdAt`
   * asc. Row shape = `listPayments`'s exact mapper plus `invoiceRecordId` so the client can
   * label rows by invoice and invalidate that invoice's `listPayments` query on record/delete/
   * refund. `listPayments` itself is untouched — the invoice drawer keeps its exact query key.
   */
  listPaymentsForWorkOrder: moneyViewProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId: workOrderInstanceId } = parseRecordId(input.workOrderRecordId)
      const rows = await listWorkOrderPayments({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId,
      })

      const mapped = await mapPaymentRows(ctx.session.organizationId, rows)
      const invoiceRecordIdByRow = new Map(rows.map((row) => [row.id, row.invoiceInstanceId]))
      return mapped.map((row) => ({
        ...row,
        // Held deposits (money MP2 §B.6/§B.9) have no invoice until settle — null, not a crash.
        invoiceRecordId: invoiceRecordIdByRow.get(row.id)
          ? toRecordId('invoice', invoiceRecordIdByRow.get(row.id)!)
          : null,
      }))
    }),

  /**
   * Quote-scoped payments read for the quote drawer's deposit card (money 16 §D.5) — every
   * ledger row against a quote (in practice: its held/applied/refunded deposit charge and any
   * refund copy), `createdAt` asc, mapped through the exact `listPayments`/
   * `listPaymentsForWorkOrder` row shape so the card doesn't need its own type.
   */
  listPaymentsForQuote: moneyViewProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId: quoteInstanceId } = parseRecordId(input.quoteRecordId)
      const rows = await database.query.PaymentTransaction.findMany({
        where: and(
          eq(schema.PaymentTransaction.organizationId, ctx.session.organizationId),
          eq(schema.PaymentTransaction.quoteInstanceId, quoteInstanceId)
        ),
        orderBy: asc(schema.PaymentTransaction.createdAt),
      })

      return mapPaymentRows(ctx.session.organizationId, rows)
    }),

  // ─── Send flow (money MQ2 build spec §E.5) ──────────────────────────────

  prepareDocumentEmail: moneyProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return prepareDocumentEmail({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteRecordId: input.recordId,
      })
    }),

  ensureDocumentPdf: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return ensureQuoteDocumentPdf({
        organizationId: ctx.session.organizationId,
        actorId: ctx.session.user.id,
        quoteRecordId: input.quoteRecordId,
      })
    }),

  previewDocumentPdf: moneyProcedure.mutation(async ({ ctx }) => {
    return renderPreviewQuotePdf({
      organizationId: ctx.session.organizationId,
      actorId: ctx.session.user.id,
    })
  }),
})
