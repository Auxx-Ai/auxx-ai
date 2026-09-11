// apps/web/src/server/api/routers/credit-memo.ts
//
// The credit memo actions generic record mutations cannot do
// (plans/accounting/tasks/10-credit-memos.md section 10.8). A draft memo and its
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

import {
  applyCreditMemo,
  issueCreditMemo,
  listOpenInvoicesForContact,
  previewIssueCreditMemo,
  readContactCredit,
  readCreditMemoSettlement,
  recordManualRefund,
  refundTransaction,
  settleCreditMemo,
  unapplyCreditMemo,
  voidCreditMemo,
} from '@auxx/lib/money'
import { PermissionKey } from '@auxx/lib/permissions'
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
   * Pay part of an issued memo's balance back. `manual` records a succeeded
   * refund row on the spot; `stripe` initiates a (partial) refund of the named
   * charge and the webhook flips it to succeeded. Both rows carry the memo, so
   * `settleCreditMemo` sums them; it is run here too so a manual refund lands
   * `settled` in the same call.
   */
  refund: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        creditMemoRecordId: recordIdSchema,
        /** Integer minor units, at most the memo's balance. */
        amount: z.number().int().positive(),
        rail: z.enum(['manual', 'stripe']),
        /** Manual rail only. */
        method: z.enum(['cash', 'check', 'card', 'bank', 'other']).optional(),
        reference: z.string().max(200).optional(),
        note: z.string().max(2000).optional(),
        /** `YYYY-MM-DD`, manual rail only. Defaults to today. */
        date: calendarDaySchema.optional(),
        /** Stripe rail only: the `succeeded` charge to refund against. */
        chargeTransactionId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const userId = ctx.session.userId
      const { entityInstanceId: creditMemoInstanceId } = parseRecordId(input.creditMemoRecordId)

      let transactionId: string
      if (input.rail === 'manual') {
        const { transactionId: id } = await recordManualRefund({
          organizationId,
          userId,
          creditMemoInstanceId,
          amount: input.amount,
          date: input.date ?? new Date().toISOString().slice(0, 10),
          method: input.method ?? 'other',
          reference: input.reference,
          note: input.note,
        })
        transactionId = id
      } else {
        if (!input.chargeTransactionId) {
          throw new Error('A Stripe refund needs the charge to refund against')
        }
        const { transactionId: id } = await refundTransaction({
          organizationId,
          userId,
          transactionId: input.chargeTransactionId,
          amount: input.amount,
          creditMemoInstanceId,
        })
        transactionId = id
      }

      const settlement = await settleCreditMemo(ctx.db, {
        organizationId,
        userId,
        creditMemoInstanceId,
      })
      return { transactionId, ...settlement }
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
