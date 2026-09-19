// apps/web/src/server/api/routers/vendor-credit.ts
//
// The vendor credit actions generic record mutations cannot do
// (plans/accounting/tasks/71-one-cash-endpoint.md §5 U7). A draft credit and
// its lines are created and edited through the ordinary record doors; what is
// here is what moves the ledger or the subledger: create, issue, void, apply,
// unapply, refund, and the two reads the drawer and the dialogs render.
//
// Nested under `purchasing` as `purchasing.vendorCredit.*`.
//
// Permission assertion mirrors `creditMemo`: `ledgerPost` for anything that
// writes to the books or moves A/P, `ledgerView` for the reads and the preview.

import { postVendorRefundAccounting, recordVendorRefund } from '@auxx/lib/accounting/money'
import {
  applyVendorCredit,
  createVendorCredit,
  issueVendorCredit,
  listOpenBillsForVendor,
  listVendorBillCreditApplications,
  previewIssueVendorCredit,
  readVendorCreditSettlement,
  settleVendorCredit,
  unapplyVendorCredit,
  voidVendorCredit,
} from '@auxx/lib/accounting/purchasing'
import { PermissionKey } from '@auxx/lib/permissions'
import { parseRecordId, recordIdSchema } from '@auxx/types/resource'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const calendarDaySchema = z.iso.date({ error: 'Expected YYYY-MM-DD' })

const lineSchema = z.object({
  description: z.string().max(500).optional(),
  quantity: z.number().positive(),
  /** Integer minor units per unit. */
  unitPrice: z.number().int().min(0),
  /** Integer minor units. Defaults to `quantity * unitPrice`. */
  lineTotal: z.number().int().optional(),
  /** The `gl_account` instance id. Absent lets the GRNI prefill decide. */
  glAccountInstanceId: z.string().min(1).optional(),
  partRecordId: recordIdSchema.optional(),
  purchaseOrderLineRecordId: recordIdSchema.optional(),
  /** 73 §8.2: issuing this line sends the goods back. Needs a part. */
  returnsStock: z.boolean().optional(),
})

export const vendorCreditRouter = createTRPCRouter({
  /**
   * A draft credit with its lines. A credit raised against a PO-backed bill
   * gets its uncoded lines prefilled with the org's resolved GRNI account.
   */
  create: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        vendorRecordId: recordIdSchema,
        billRecordId: recordIdSchema.optional(),
        purchaseOrderRecordId: recordIdSchema.optional(),
        vendorReference: z.string().max(200).optional(),
        reason: z.string().max(60).optional(),
        note: z.string().max(2000).optional(),
        issuedAt: calendarDaySchema.optional(),
        /** Integer minor units. */
        taxTotal: z.number().int().min(0).optional(),
        lines: z.array(lineSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createVendorCredit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorCompanyInstanceId: parseRecordId(input.vendorRecordId).entityInstanceId,
        ...(input.billRecordId
          ? { vendorBillInstanceId: parseRecordId(input.billRecordId).entityInstanceId }
          : {}),
        ...(input.purchaseOrderRecordId
          ? {
              purchaseOrderInstanceId: parseRecordId(input.purchaseOrderRecordId).entityInstanceId,
            }
          : {}),
        ...(input.vendorReference ? { vendorReference: input.vendorReference } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.note ? { note: input.note } : {}),
        ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
        ...(input.taxTotal !== undefined ? { taxTotal: input.taxTotal } : {}),
        lines: input.lines.map((line) => ({
          ...(line.description ? { description: line.description } : {}),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          ...(line.lineTotal !== undefined ? { lineTotal: line.lineTotal } : {}),
          ...(line.glAccountInstanceId ? { glAccountInstanceId: line.glAccountInstanceId } : {}),
          ...(line.partRecordId
            ? { partInstanceId: parseRecordId(line.partRecordId).entityInstanceId }
            : {}),
          ...(line.purchaseOrderLineRecordId
            ? {
                purchaseOrderLineInstanceId: parseRecordId(line.purchaseOrderLineRecordId)
                  .entityInstanceId,
              }
            : {}),
          ...(line.returnsStock ? { returnsStock: true } : {}),
        })),
      })
    }),

  /**
   * Issue a draft: post `Dr A/P / Cr <each line's account>` dated `issuedAt`,
   * flip to `issued`, settle. A refused post throws with the reason and leaves
   * the draft untouched.
   */
  issue: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        vendorCreditRecordId: recordIdSchema,
        issuedAt: calendarDaySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorCreditRecordId)
      return issueVendorCredit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorCreditInstanceId: entityInstanceId,
        ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
      })
    }),

  /** What issuing WOULD post. Persists nothing; `blockedBy` carries a refusal. */
  previewIssue: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        vendorCreditRecordId: recordIdSchema,
        issuedAt: calendarDaySchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorCreditRecordId)
      return previewIssueVendorCredit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorCreditInstanceId: entityInstanceId,
        ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
      })
    }),

  /** Void: reverse the issue entry, then set `void`. Refused once anything is applied. */
  void: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ vendorCreditRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorCreditRecordId)
      await voidVendorCredit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorCreditInstanceId: entityInstanceId,
      })
    }),

  /** Apply part of an issued credit's balance to one posted bill of the same vendor. */
  applyToBill: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        vendorCreditRecordId: recordIdSchema,
        vendorBillRecordId: recordIdSchema,
        commandKey: z.string().min(1).max(200),
        /** Integer minor units. */
        amount: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return applyVendorCredit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorCreditInstanceId: parseRecordId(input.vendorCreditRecordId).entityInstanceId,
        vendorBillInstanceId: parseRecordId(input.vendorBillRecordId).entityInstanceId,
        amount: input.amount,
        commandKey: input.commandKey,
      })
    }),

  /** Take an application back. Refused when it was applied in a settled period. */
  unapplyFromBill: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ applicationRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.applicationRecordId)
      await unapplyVendorCredit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        applicationInstanceId: entityInstanceId,
      })
    }),

  /**
   * Record the supplier paying part of an issued credit back, then post it.
   * Posting is a separate call so a misconfigured ledger refuses the journal
   * without also refusing to record that the money arrived.
   */
  refund: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        vendorCreditRecordId: recordIdSchema,
        commandKey: z.string().min(1).max(200),
        /** Integer minor units, at most the credit's balance. */
        amount: z.number().int().positive(),
        method: z.enum(['cash', 'check', 'card', 'bank', 'other']).optional(),
        /** The rail the money arrived on. Exclusive with `bankAccountInstanceId`. */
        paymentGatewayId: z.string().min(1).nullish(),
        /** The `bank_account` the money arrived in. Exclusive with the rail. */
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
      const { entityInstanceId: vendorCreditInstanceId } = parseRecordId(input.vendorCreditRecordId)

      const { moneyTransactionId } = await recordVendorRefund(ctx.db, {
        organizationId,
        userId,
        vendorCreditInstanceId,
        amountMinor: input.amount,
        commandKey: input.commandKey,
        date: input.date ?? new Date().toISOString().slice(0, 10),
        method: input.method ?? 'other',
        paymentGatewayId: input.paymentGatewayId ?? null,
        bankAccountInstanceId: input.bankAccountInstanceId ?? null,
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.note ? { note: input.note } : {}),
      })
      await postVendorRefundAccounting(ctx.db, {
        organizationId,
        moneyTransactionId,
        actorUserId: userId,
      })

      const settlement = await settleVendorCredit(ctx.db, {
        organizationId,
        userId,
        vendorCreditInstanceId,
      })
      return { transactionId: moneyTransactionId, ...settlement }
    }),

  /** Total, applied, refunded, balance, and the application and refund rows behind them. */
  settlement: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ vendorCreditRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorCreditRecordId)
      return readVendorCreditSettlement(ctx.db, ctx.session.organizationId, entityInstanceId)
    }),

  /** The vendor's bills with something still owed, for the apply picker. */
  openBills: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ vendorRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorRecordId)
      return listOpenBillsForVendor(ctx.db, ctx.session.organizationId, entityInstanceId)
    }),

  /** The credits raised against one bill, for the bill's credits card. */
  listForBill: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ vendorBillRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.vendorBillRecordId)
      return listVendorBillCreditApplications(ctx.db, ctx.session.organizationId, entityInstanceId)
    }),
})
