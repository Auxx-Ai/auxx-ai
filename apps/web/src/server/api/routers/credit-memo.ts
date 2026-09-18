// apps/web/src/server/api/routers/credit-memo.ts
//
// The credit memo actions generic record mutations cannot do
// (plans/accounting/tasks/done/10-credit-memos.md section 10.8). A draft memo and its
// lines are created, edited and discarded through `record.create` /
// `record.createMany` / `fieldValue.set` / `record.delete`, exactly as an
// invoice is; the number hook, the totals hook and the delete guard in lib
// carry the rules those generic doors need. What is here is what moves the
// ledger or the subledger: issue, void, apply, unapply, refund, and the three
// aggregate reads the drawer and the dialogs render.
//
// Permission assertion mirrors `money.writeOffInvoice`: `ledgerPost` for
// anything that writes to the books or moves A/R, `ledgerView` for the reads and
// the preview. Record ids cross the wire as `RecordId`.

import { postCustomerRefundAccounting } from '@auxx/lib/accounting/money/customer-money'
import { PermissionKey } from '@auxx/lib/permissions'
import {
  applyCreditMemo,
  issueCreditMemo,
  listOpenInvoicesForContact,
  previewIssueCreditMemo,
  readContactCredit,
  readCreditMemoSettlement,
  recordCreditMemoRefund,
  refundCreditMemoToCard,
  settleCreditMemo,
  unapplyCreditMemo,
  voidCreditMemo,
} from '@auxx/lib/sales'
import { parseRecordId, recordIdSchema, toRecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const calendarDaySchema = z.iso.date({ error: 'Expected YYYY-MM-DD' })

export const creditMemoRouter = createTRPCRouter({
  /**
   * Issue a draft: post `Dr 4090 / Dr sales tax / Cr A/R` dated `issuedAt`,
   * flip to `issued`, settle. A refused post (a locked period, an unmapped
   * role) throws with the reason and leaves the draft untouched. Refuses a memo
   * with no lines, no contact, or a zero total, because generic create cannot.
   */
  issue: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        creditMemoRecordId: recordIdSchema,
        /** `YYYY-MM-DD`. Defaults to the stored date, then to today in the book time zone. */
        issuedAt: calendarDaySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.creditMemoRecordId)
      return issueCreditMemo(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        creditMemoInstanceId: entityInstanceId,
        issuedAt: input.issuedAt,
      })
    }),

  /** What issuing WOULD post. Persists nothing; `blockedBy` carries a refusal. */
  previewIssue: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        creditMemoRecordId: recordIdSchema,
        issuedAt: calendarDaySchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.creditMemoRecordId)
      return previewIssueCreditMemo(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        creditMemoInstanceId: entityInstanceId,
        issuedAt: input.issuedAt,
      })
    }),

  /**
   * Void: reverse the issue entry, then set `void`. Refused once anything has
   * been applied or refunded. A channel draft is voided without a posting.
   */
  void: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ creditMemoRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.creditMemoRecordId)
      await voidCreditMemo(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        creditMemoInstanceId: entityInstanceId,
      })
    }),

  /** Apply part of an issued memo's balance to one open invoice of the same contact. */
  applyCredit: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        creditMemoRecordId: recordIdSchema,
        invoiceRecordId: recordIdSchema,
        commandKey: z.string().min(1).max(200),
        /** Integer minor units. */
        amount: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return applyCreditMemo(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        creditMemoInstanceId: parseRecordId(input.creditMemoRecordId).entityInstanceId,
        invoiceInstanceId: parseRecordId(input.invoiceRecordId).entityInstanceId,
        amount: input.amount,
        commandKey: input.commandKey,
      })
    }),

  /** Take an application back. Refused when it was applied in a settled period. */
  unapplyCredit: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ applicationRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.applicationRecordId)
      await unapplyCreditMemo(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        applicationInstanceId: entityInstanceId,
      })
    }),

  /**
   * Pay part of an issued memo's balance back: records a succeeded refund row
   * on the spot, then posts its accounting. `settleCreditMemo` is run here too
   * so the refund lands `settled` in the same call. `refundToCard` is the same
   * act through Stripe instead of by hand.
   */
  refund: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        creditMemoRecordId: recordIdSchema,
        commandKey: z.string().min(1).max(200),
        /** Integer minor units, at most the memo's balance. */
        amount: z.number().int().positive(),
        method: z.enum(['cash', 'check', 'card', 'bank', 'other']).optional(),
        /**
         * The `bank_account` the money left. Required when the method's route
         * is `cash`, forbidden when it is `undeposited_funds`.
         */
        bankAccountInstanceId: z.string().min(1).nullish(),
        reference: z.string().max(200).optional(),
        note: z.string().max(2000).optional(),
        /** `YYYY-MM-DD`. Defaults to today. */
        date: calendarDaySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const userId = ctx.session.userId
      const { entityInstanceId: creditMemoInstanceId } = parseRecordId(input.creditMemoRecordId)

      // 64 U2: the canonical money owners, then accounting. Posting is a
      // separate call so a misconfigured ledger refuses the journal without
      // also refusing to record that the customer got their money back.
      const { moneyTransactionId } = await recordCreditMemoRefund(ctx.db, {
        organizationId,
        userId,
        creditMemoInstanceId,
        amountMinor: input.amount,
        commandKey: input.commandKey,
        date: input.date ?? new Date().toISOString().slice(0, 10),
        method: input.method ?? 'other',
        bankAccountInstanceId: input.bankAccountInstanceId ?? null,
        reference: input.reference,
        note: input.note,
      })
      await postCustomerRefundAccounting(ctx.db, {
        organizationId,
        moneyTransactionId,
        actorUserId: userId,
      })

      const settlement = await settleCreditMemo(ctx.db, {
        organizationId,
        userId,
        creditMemoInstanceId,
      })
      return { transactionId: moneyTransactionId, ...settlement }
    }),

  /**
   * Give a card-paid memo's balance back through Stripe Connect. `commandKey` is both the
   * money command's retry key and Stripe's own idempotency key, so a resubmitted dialog
   * cannot issue a second refund.
   */
  refundToCard: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        creditMemoRecordId: recordIdSchema,
        commandKey: z.string().min(1).max(200),
        /** Integer minor units, at most the memo's balance. */
        amount: z.number().int().positive(),
        /** The card receipt to refund. Absent picks the invoice's newest with room left. */
        moneyTransactionId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId: creditMemoInstanceId } = parseRecordId(input.creditMemoRecordId)
      const { moneyTransactionId, stripeRefundId } = await refundCreditMemoToCard(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        creditMemoInstanceId,
        amountMinor: input.amount,
        commandKey: input.commandKey,
        ...(input.moneyTransactionId ? { moneyTransactionId: input.moneyTransactionId } : {}),
      })
      return { transactionId: moneyTransactionId, stripeRefundId }
    }),

  /** Total, applied, refunded, balance, and the application and refund rows behind them. */
  settlement: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ creditMemoRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.creditMemoRecordId)
      return readCreditMemoSettlement(ctx.db, {
        organizationId: ctx.session.organizationId,
        creditMemoInstanceId: entityInstanceId,
      })
    }),

  /** The credit a contact can still draw on, and the issued memos it is the sum of. */
  contactCredit: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ contactRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.contactRecordId)
      const credit = await readContactCredit(ctx.db, {
        organizationId: ctx.session.organizationId,
        contactInstanceId: entityInstanceId,
      })
      return {
        contactRecordId: input.contactRecordId,
        /** Integer minor units. */
        available: credit.creditAvailableMinor,
        memos: credit.memos.map((memo) => ({
          creditMemoRecordId: toRecordId('credit_memo', memo.creditMemoInstanceId),
          number: memo.number,
          issuedAt: memo.issuedAt,
          /** Integer minor units. */
          total: memo.totalMinor,
          balance: memo.balanceMinor,
        })),
      }
    }),

  /** The contact's `sent`/`partially_paid` invoices with a balance, for the apply picker. */
  openInvoices: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ contactRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.contactRecordId)
      const rows = await listOpenInvoicesForContact(ctx.db, {
        organizationId: ctx.session.organizationId,
        contactInstanceId: entityInstanceId,
      })
      return rows.map((row) => ({
        ...row,
        invoiceRecordId: toRecordId('invoice', row.invoiceInstanceId),
      }))
    }),
})
