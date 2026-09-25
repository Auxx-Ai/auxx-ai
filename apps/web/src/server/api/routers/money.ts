// apps/web/src/server/api/routers/money.ts

import { listBankAccounts } from '@auxx/lib/accounting/banking'
import type { InvoicePaymentRow } from '@auxx/lib/accounting/money'
import {
  acceptInvoiceReceiptAccounting,
  acceptVendorPaymentAccounting,
  clearBankDeposit,
  createBankDeposit,
  disconnectPaymentAccount,
  getBankDeposit,
  getPaymentAccount,
  listBankDeposits,
  listInvoiceMoneyPayments,
  listPayouts,
  listQuoteDepositReceipts,
  listUndepositedPayments,
  listVendorBillPayments,
  listWorkOrderMoneyPayments,
  PAYOUT_STATUSES,
  recordInvoicePayment,
  recordVendorPayment,
  syncAccountState,
  syncPayouts,
  updateBankDeposit,
  voidInvoicePayment,
} from '@auxx/lib/accounting/money'
import {
  listOrderMoneyTransactions,
  postCustomerReceiptAccounting,
  postCustomerRefundAccounting,
  readOrderMoneyCoverage,
  resolveImportedMoneyReferences,
} from '@auxx/lib/accounting/money/customer-money'
import { listRailStrip } from '@auxx/lib/accounting/money/payouts'
import { listPaymentGateways } from '@auxx/lib/accounting/rails'
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
  ensureQuoteDocumentPdf,
  fulfillOrder,
  getContactBillingOverview,
  getInvoiceSchedule,
  getWorkOrderBillingState,
  markInvoiceSent,
  markQuoteSent,
  prepareDocumentEmail,
  previewFulfillment,
  previewInvoiceBatch,
  previewWriteOffInvoice,
  readOrderForFulfillment,
  readWriteOffState,
  recomputeTotals,
  reorderLines,
  runInvoiceBatch,
  saveBillingInstallments,
  setInvoiceSchedule,
  voidInvoice,
  writeOffInvoice,
} from '@auxx/lib/accounting/sales'
import { conditionGroupsSchema } from '@auxx/lib/conditions'
import { isRecordConnectorManaged } from '@auxx/lib/data-connectors'
import { renderPreviewQuotePdf } from '@auxx/lib/documents'
import { NotFoundError } from '@auxx/lib/errors'
import { FeaturePermissionService, getCapabilities, PermissionKey } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  describeRecurrence,
  type RecurrencePattern,
  recurrencePatternSchema,
} from '@auxx/lib/recurrence'
import { getOrganizationSetting } from '@auxx/lib/settings'
import { parseRecordId, recordIdSchema, toRecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure, protectedProcedure } from '../trpc'

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

/** {@link listPayments}'s exact row shape, shared by the work-order and quote reads. */
type PaymentListRow = InvoicePaymentRow & {
  createdByUserId: null
  stripeRefundId: null
  refundedTransactionId: null
  invoiceInstanceId: string | null
  quoteInstanceId: string | null
  workOrderInstanceId: string | null
  heldAmount: number
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
        /** Defaults to `line_item`; the sort attribute is derived from it. */
        lineEntityType: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return reorderLines({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        documentRecordId: input.documentRecordId,
        lineEntityType: input.lineEntityType,
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
        range: z.object({ from: z.iso.date(), to: z.iso.date() }),
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
        range: z.object({ from: z.iso.date(), to: z.iso.date() }),
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

  // The manual "push this invoice to QuickBooks" mutation (plan 37e §3, P3) was an orphan, no
  // screen ever called it, and it is gone as of 2026-09-10: the invoice document mirror was
  // retired on MK's decision (accounting brief 14's DECIDED block). QuickBooks now receives
  // journal entries only, through `quickbooks-accounting-provider.ts`; `LedgerCard`'s retry
  // action is the export surface.

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId: workOrderInstanceId } = parseRecordId(input.workOrderRecordId)
      return setInvoiceSchedule({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId,
        pattern: input.pattern,
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

  /**
   * Which destinations a recorded payment can take, per method, plus the bank
   * accounts it can name (task 54 unit 2b).
   *
   * 🔑 Here rather than on `bankAccount.list`, which gates on `ledgerView` — a
   * desk user who records payments holds the dispatch keys and may hold no
   * ledger key at all. Same route table the command enforces with, so the
   * dialog cannot offer a shape the server will refuse.
   *
   * ⚠️ Only accounts with a `bank_account_gl_account` link are offered: the
   * receipt's debit resolves through that pointer, so an unlinked account would
   * be a choice that always fails at posting time.
   */
  paymentDestinations: moneyViewProcedure.query(async ({ ctx }) => {
    const [accounts, gateways] = await Promise.all([
      listBankAccounts(ctx.db, { organizationId: ctx.session.organizationId }),
      listPaymentGateways(ctx.db, ctx.session.organizationId),
    ])
    if (accounts.isErr()) throw accounts.error
    if (gateways.isErr()) throw gateways.error
    return {
      bankAccounts: accounts.value
        .filter((account) => account.glAccountId && !account.archivedAt)
        .map((account) => ({
          id: account.id,
          name: account.name ?? account.institution ?? 'Bank account',
          last4: account.last4,
        })),
      // A rail is offerable only once it names the clearing account its receipts
      // and refunds post to.
      paymentGateways: gateways.value
        .filter((gateway) => gateway.clearingGlAccountId)
        .map((gateway) => ({ id: gateway.id, name: gateway.name })),
    }
  }),

  /** Every payment applied to one vendor bill — the A/P twin of `listPayments`. */
  billPayments: moneyViewProcedure
    .input(z.object({ vendorBillRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorBillRecordId)
      return listVendorBillPayments(ctx.db, {
        organizationId: ctx.session.organizationId,
        vendorBillInstanceId: entityInstanceId,
      })
    }),

  /**
   * Pay a vendor bill. The money is recorded first and its journal accepted
   * after, so a ledger that is not set up refuses the posting without also
   * refusing to record that the vendor was paid.
   */
  recordBillPayment: moneyProcedure
    .input(
      z.object({
        vendorBillRecordId: recordIdSchema,
        /** Integer cents. */
        amount: z.number().int().positive(),
        /** Integer cents the vendor forgave under terms (74 D3). */
        discount: z.number().int().nonnegative().optional(),
        /** ISO date string (`yyyy-MM-dd`) — the day the money left. */
        date: z.string(),
        method: z.enum(['cash', 'check', 'card', 'bank', 'other']),
        /** The rail the money went out on. Exclusive with `bankAccountInstanceId`. */
        paymentGatewayId: z.string().nullish(),
        /** The `bank_account` the money left. Exclusive with the rail. */
        bankAccountInstanceId: z.string().nullish(),
        reference: z.string().optional(),
        note: z.string().optional(),
        commandKey: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorBillRecordId)
      const recorded = await recordVendorPayment(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        vendorBillInstanceId: entityInstanceId,
        amountMinor: input.amount,
        discountMinor: input.discount ?? 0,
        date: input.date,
        method: input.method,
        paymentGatewayId: input.paymentGatewayId,
        bankAccountInstanceId: input.bankAccountInstanceId,
        reference: input.reference,
        note: input.note,
        commandKey: input.commandKey,
      })
      const posting = await acceptVendorPaymentAccounting(ctx.db, {
        organizationId: ctx.session.organizationId,
        moneyTransactionId: recorded.moneyTransactionId,
        actorUserId: ctx.session.user.id,
      })
      return { ...recorded, postingStatus: posting.status }
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
        /** The rail the money arrived on. Exclusive with `bankAccountInstanceId`. */
        paymentGatewayId: z.string().nullish(),
        /** The `bank_account` record the money landed in. Exclusive with the rail. */
        bankAccountInstanceId: z.string().nullish(),
        reference: z.string().optional(),
        note: z.string().optional(),
        /**
         * Idempotency key. The dialog mints one per open, so a double submit or
         * a retried request records the payment once.
         */
        commandKey: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      // Task 54: the money model, not `PaymentTransaction`. The receipt is
      // recorded first and its journal accepted after, so a ledger that is not
      // set up refuses the posting without also refusing to record that the
      // customer paid.
      const recorded = await recordInvoicePayment(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
        amountMinor: input.amount,
        date: input.date,
        method: input.method,
        paymentGatewayId: input.paymentGatewayId,
        bankAccountInstanceId: input.bankAccountInstanceId,
        reference: input.reference,
        note: input.note,
        commandKey: input.commandKey,
      })
      const posting = await acceptInvoiceReceiptAccounting(ctx.db, {
        organizationId: ctx.session.organizationId,
        moneyTransactionId: recorded.moneyTransactionId,
        actorUserId: ctx.session.user.id,
      })
      return { ...recorded, postingStatus: posting.status }
    }),

  /**
   * Undo a recorded payment. One lane now: a money-model receipt is VOIDED — an
   * immutable, hashed effect cannot be deleted, so the mistake is corrected by
   * a second, reversing entry (task 54 unit 3; step 0 of the accounting
   * migration drops the legacy `PaymentTransaction` delete branch alongside it).
   */
  deletePayment: moneyAdminProcedure
    .input(
      z.object({
        transactionId: z.string(),
        /** Carried onto the correction's journal memo. */
        reason: z.string().max(500).optional(),
        /** Idempotency key. */
        commandKey: z.string().min(1).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await voidInvoicePayment(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        moneyTransactionId: input.transactionId,
        reason: input.reason,
        commandKey: input.commandKey ?? `void:${input.transactionId}`,
      })
    }),

  /**
   * Post accounting for an already-recorded customer refund `MoneyTransaction`
   * (accounting migration step 0 — the legacy Stripe-charge `refundTransaction`
   * is gone). `postCustomerRefundAccounting` only accepts a refund settled
   * against a credit memo today; a direct, no-credit-memo refund has no
   * accounting door yet, so this stays unreachable from `listPayments`'s
   * money-only rows (`payments-list.tsx` never offers Refund for `provider:
   * 'money'`) until that gap is closed.
   */
  refundTransaction: moneyAdminProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return postCustomerRefundAccounting(ctx.db, {
        organizationId: ctx.session.organizationId,
        moneyTransactionId: input.transactionId,
        actorUserId: ctx.session.user.id,
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
      // Accounting migration step 0: the money model is the only lane —
      // `PaymentTransaction` is gone.
      const money = await listInvoiceMoneyPayments(ctx.db, {
        organizationId: ctx.session.organizationId,
        invoiceInstanceId: entityInstanceId,
      })
      return money.map((row) => ({
        ...row,
        createdByUserId: null,
        stripeRefundId: null,
        refundedTransactionId: null,
        invoiceInstanceId: entityInstanceId,
        quoteInstanceId: null,
        workOrderInstanceId: null,
        heldAmount: 0,
      }))
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
      // Accounting migration step 0: the money model is the only lane —
      // `PaymentTransaction` is gone, and with it the held-deposit-with-no-invoice
      // branch the legacy read had (quote deposits have no money-model source).
      const rows = await listWorkOrderMoneyPayments(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId,
      })
      return rows.map((row) => ({
        ...row,
        createdByUserId: null,
        stripeRefundId: null,
        refundedTransactionId: null,
        quoteInstanceId: null,
        workOrderInstanceId,
        heldAmount: 0,
        invoiceRecordId: toRecordId('invoice', row.invoiceInstanceId),
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
    .query(async ({ ctx, input }): Promise<PaymentListRow[]> => {
      const { entityInstanceId: quoteInstanceId } = parseRecordId(input.quoteRecordId)
      const receipts = await listQuoteDepositReceipts(
        ctx.db,
        ctx.session.organizationId,
        quoteInstanceId
      )
      return receipts.map((receipt) => ({
        id: receipt.moneyTransactionId,
        kind: 'charge' as const,
        status: 'succeeded' as const,
        provider: 'money' as const,
        method: 'card',
        amount: receipt.amountMinor,
        allocatedAmount: receipt.appliedMinor,
        heldAmount: receipt.amountMinor - receipt.appliedMinor,
        reference: receipt.reference,
        note: null,
        date: receipt.occurredAt.slice(0, 10),
        createdByUserId: null,
        stripeRefundId: null,
        refundedTransactionId: null,
        invoiceInstanceId: null,
        quoteInstanceId,
        workOrderInstanceId: receipt.workOrderInstanceId,
      }))
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

  /**
   * The order a fulfillment would be built from: its lines, and how much of
   * each is still to ship.
   *
   * `ledgerView` rather than a dispatch key: the shipment log exists to answer
   * a ledger question, and the dialog that reads it is about to post revenue.
   */
  resolveImportedMoneyReferences: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        moneyTransactionId: z.string().min(1),
        sourceObjectIds: z.array(z.string().min(1)).max(100),
        commandKey: z.string().min(1).max(200),
        evidence: z.string().trim().min(1).max(4000),
      })
    )
    .mutation(({ ctx, input }) =>
      resolveImportedMoneyReferences(ctx.db, {
        ...input,
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
      })
    ),

  orderMoneyCoverage: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ orderId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      readOrderMoneyCoverage(ctx.db, ctx.session.organizationId, input.orderId)
    ),

  orderMoneyTransactions: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ orderId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      listOrderMoneyTransactions(ctx.db, ctx.session.organizationId, input.orderId)
    ),

  postCustomerReceipt: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ moneyTransactionId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      postCustomerReceiptAccounting(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        moneyTransactionId: input.moneyTransactionId,
      })
    ),

  orderForFulfillment: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await readOrderForFulfillment(ctx.db, {
        organizationId: ctx.session.organizationId,
        orderId: input.orderId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * What fulfilling this shipment WOULD post. Writes nothing.
   *
   * Runs the same builder and the same resolver the write runs, so what the
   * dialog shows is what the write would freeze. A refusal comes back as
   * `blockedBy`, which `EntryBlockers` renders - it is never a toast.
   */
  previewFulfillment: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        orderId: z.string().min(1),
        shippedLines: z
          .array(z.object({ lineId: z.string().min(1), quantity: z.number().positive() }))
          .min(1)
          .max(200),
        shippedAt: z.iso.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await previewFulfillment(ctx.db, {
        organizationId: ctx.session.organizationId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Record what shipped and post the revenue it recognises
   * (plans/accounting/tasks/done/01-post-revenue-to-the-ledger.md phase A, handoff
   * decision 6.6).
   *
   * 🛑 `ledgerPost`, not a `dispatch.board.*` key, and the reason is what this
   * does rather than what it is called: it writes a `GlPosting`. Recognising
   * revenue is a ledger write and `ledgerPost` is the key that says somebody may
   * make one. The lib function asserts nothing at all
   * (`docs/lib-module-guide.md` §6).
   *
   * The result carries the `PostResult` beside the shipment, because `postEntry`
   * never throws: a locked period or an unmapped revenue role is a card the
   * screen renders, not an error.
   */
  fulfillOrder: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        orderId: z.string().min(1),
        shippedLines: z
          .array(z.object({ lineId: z.string().min(1), quantity: z.number().positive() }))
          .min(1)
          .max(200),
        shippedAt: z.iso.date().optional(),
        memo: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await fulfillOrder(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Is this order bound to a data connector?
   *
   * The shipment log of a connector-managed order is DERIVED at ingest from the
   * native fulfillment fields (§8.4 decision 4), so per-order Fulfill would
   * write a second, conflicting log. The drawer asks this to hide the button.
   *
   * `ledgerView`, matching the sibling fulfillment reads: the answer only ever
   * gates a ledger action, and it discloses nothing but a boolean.
   */
  isOrderConnectorManaged: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return isRecordConnectorManaged(ctx.db, ctx.session.organizationId, input.orderId)
    }),

  /**
   * Bank deposits (plans/accounting/tasks/done/06-deposit-grouping.md, HANDOFF 1D).
   *
   * ⚠️ A BANK deposit - N received payments banked as the one line the
   * statement shows - never a customer deposit, which is a liability and lives
   * on `PaymentTransaction`.
   *
   * 🛑 Gated on the LEDGER keys, not on `dispatch.board.*` like the rest of this
   * router: every write here produces or would produce a `GlPosting`, and
   * `ledgerPost` is the key that says somebody may write to the books. Reads are
   * `ledgerView`. The lib functions assert nothing at all
   * (`docs/lib-module-guide.md` §6).
   */
  bankDeposit: createTRPCRouter({
    /**
     * Payments waiting to be banked, paged by payment date newest first.
     * Local undeposited receipts and accepted manual imports only; processor and
     * unresolved imports are excluded before pagination by the shared deposit guard.
     */
    listUndeposited: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            method: z.string().min(1).optional(),
            from: z.iso.date().optional(),
            to: z.iso.date().optional(),
            limit: z.number().int().min(1).max(500).optional(),
            cursor: z.number().int().min(0).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const { cursor, limit, ...filters } = input ?? {}
        const pageSize = limit ?? 50
        const offset = cursor ?? 0
        const result = await listUndepositedPayments(ctx.db, {
          organizationId: ctx.session.organizationId,
          ...filters,
          limit: pageSize,
          offset,
        })
        if (result.isErr()) throw result.error
        return {
          items: result.value,
          nextCursor: result.value.length === pageSize ? offset + pageSize : undefined,
        }
      }),

    /** Recorded deposits, newest first. */
    list: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            status: z.enum(['pending', 'cleared']).optional(),
            limit: z.number().int().min(1).max(500).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const result = await listBankDeposits(ctx.db, {
          organizationId: ctx.session.organizationId,
          ...(input ?? {}),
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** One deposit with the payments it grouped. */
    get: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ depositId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const result = await getBankDeposit(ctx.db, {
          organizationId: ctx.session.organizationId,
          depositId: input.depositId,
        })
        if (result.isErr()) throw result.error
        if (!result.value) throw new NotFoundError('That bank deposit does not exist')
        return result.value
      }),

    /**
     * Group the selected payments and post `Dr cash Cr undeposited_funds`.
     *
     * `ledgerPost`: this is the ledger's only writer of the `cash` role. The
     * result carries the `PostResult` alongside the record, because `postEntry`
     * never throws - a locked period is a refusal the screen renders as an
     * `EntryBlockers` card, not an error.
     */
    create: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          paymentIds: z.array(z.string().min(1)).min(1).max(500),
          depositDate: z.iso.date(),
          // 🛑 The ACCOUNT, not a chart code. The code is read off the account's
          // own mapping, because the feed posts every line on it against that
          // mapping - a free code puts the deposit and the statement line it
          // exists to match into two different accounts.
          bankAccountId: z.string().min(1).max(64),
          reference: z.string().max(120).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await createBankDeposit(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.userId,
          ...input,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Match a deposit to the bank line that shows it.
     *
     * `ledgerPost` rather than a read key: clearing FREEZES the row, and after
     * it the only correction is a reversal.
     */
    clear: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          depositId: z.string().min(1),
          bankTransactionId: z.string().min(1).max(200),
          clearedAt: z.string().datetime().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await clearBankDeposit(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.userId,
          depositId: input.depositId,
          bankTransactionId: input.bankTransactionId,
          clearedAt: input.clearedAt ? new Date(input.clearedAt) : undefined,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** Correct a deposit's slip details while it is still unmatched and unposted. */
    update: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          depositId: z.string().min(1),
          depositDate: z.iso.date().optional(),
          bankAccountId: z.string().min(1).max(64).optional(),
          reference: z.string().max(120).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await updateBankDeposit(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.userId,
          ...input,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),
  }),

  /**
   * Gateway payouts: the list, and the manual "Sync now" (HANDOFF §11.5 item 1).
   *
   * 🛑 Gated on the LEDGER keys for `bankDeposit`'s reason: the sync produces
   * `GlPosting` rows, so it belongs with the people trusted to write to the
   * books. There is no create, update or delete procedure at all - a payout is
   * a transcription of what the gateway did, and the only sanctioned writers
   * are the SOURCES (brief 27 §4): the Stripe sync today, imports next. A wrong
   * payout is corrected by reversal.
   */
  payout: createTRPCRouter({
    /**
     * The per-rail strip (brief 27 §8.2): every rail with a clearing account,
     * the account, its balance, last settled, last fee booked, and how it is
     * relieved. Closed rails stay while their account holds a balance.
     *
     * ⚠️ The balance answers for the ACCOUNT, not the rail (26 §9.1). A shared
     * account comes back on every rail naming it with `sharedWith` set, and the
     * screen must say so rather than present one number as two.
     */
    rails: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
      const result = await listRailStrip(ctx.db, { organizationId: ctx.session.organizationId })
      if (result.isErr()) throw result.error
      return result.value
    }),

    /**
     * Recorded payouts, newest first, one page at a time.
     *
     * The cursor is the next OFFSET: the sort key is a coalesce over two field
     * values, so there is no single column a keyset cursor could name. A page
     * shorter than `limit` is the last one.
     */
    list: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            status: z.enum(PAYOUT_STATUSES).optional(),
            /** Only payouts that left something in `2450` - the queue somebody works. */
            onlyUnidentified: z.boolean().optional(),
            search: z.string().max(200).optional(),
            from: z.string().max(10).optional(),
            to: z.string().max(10).optional(),
            limit: z.number().int().min(1).max(500).optional(),
            cursor: z.number().int().min(0).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 50
        const offset = input?.cursor ?? 0
        const result = await listPayouts(ctx.db, {
          organizationId: ctx.session.organizationId,
          ...(input ?? {}),
          limit,
          offset,
        })
        if (result.isErr()) throw result.error
        return {
          items: result.value,
          nextCursor: result.value.length === limit ? offset + limit : null,
        }
      }),

    /**
     * Pull the gateway's recent payouts now, rather than waiting for the nightly
     * sweep or the next `payout.paid` webhook.
     *
     * ⚠️ Returns the run's summary INCLUDING its refusals rather than throwing
     * on them. One payout whose arithmetic the builder refuses must not present
     * as "the sync failed" when eleven others posted; the screen renders the
     * refusals as `EntryBlockers` cards naming each payout.
     */
    syncNow: permissionProcedure(PermissionKey.ledgerPost).mutation(async ({ ctx }) => {
      const result = await syncPayouts(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.user.id,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
  }),

  /**
   * Write off an invoice's balance to bad debt (HANDOFF slot 2K,
   * gap-analysis.md §3 item 9). `ledgerPost` for the same reason `bankDeposit`
   * above is: this produces a `GlPosting`, so it belongs with the people
   * trusted to write to the books. `postEntry` never throws - a locked period
   * or an unmapped role is a refusal the dialog renders as `EntryBlockers`,
   * not an error, and the invoice's own status is untouched until the post
   * actually lands.
   */
  writeOffInvoice: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        invoiceRecordId: recordIdSchema,
        amountMinor: z.number().int().positive().optional(),
        reason: z.string().min(1).max(2000),
        expenseGlAccountId: z.string().min(1).max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return writeOffInvoice(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        invoiceId: entityInstanceId,
        amountMinor: input.amountMinor,
        reason: input.reason,
        expenseGlAccountId: input.expenseGlAccountId,
      })
    }),

  /**
   * What is still writable off on one invoice, and what has already gone.
   *
   * 🛑 The dialog prefills and bounds on `outstandingMinor`, never on the
   * invoice's mirrored `invoice_balance`: after a partial write-off the mirror
   * reads high, because `syncInvoicePaymentState` re-derives it as
   * `total - amountPaid` and knows nothing about bad debt.
   */
  writeOffState: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return readWriteOffState(ctx.db, {
        organizationId: ctx.session.organizationId,
        invoiceId: entityInstanceId,
      })
    }),

  /** What a write-off WOULD look like. Persists nothing. */
  previewWriteOff: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        invoiceRecordId: recordIdSchema,
        amountMinor: z.number().int().positive().optional(),
        expenseGlAccountId: z.string().min(1).max(64).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return previewWriteOffInvoice(ctx.db, {
        organizationId: ctx.session.organizationId,
        invoiceId: entityInstanceId,
        amountMinor: input.amountMinor,
        expenseGlAccountId: input.expenseGlAccountId,
      })
    }),
})
