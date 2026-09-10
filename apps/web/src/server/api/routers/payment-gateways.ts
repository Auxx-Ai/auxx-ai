// apps/web/src/server/api/routers/payment-gateways.ts
//
// Payment gateways: a record carrying its own clearing account, never a role
// (plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md §5.3). Mounted
// as `paymentGateway` in `root.ts`.
//
// 🛑 Reads are `ledgerView`. Writes are `ledgerControl`, the same rung
// `banking.ts`'s `bankAccount.create`/`update` use: a gateway's clearing
// account decides where card and BNPL money lands on the balance sheet, which
// is a rung above ordinary bookkeeping (`ledgerPost`).
//
// 🛑 Every refusal reaches the browser as an `AuxxError` verbatim (HANDOFF
// ground rule 9). `assertClearingAccount`/`assertHandlesAvailable` in
// `writes.ts` already say which account or which handle is wrong; a second
// authority here would drift from it.

import {
  archivePaymentGateway,
  createPaymentGateway,
  listPaymentGateways,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCES,
  updatePaymentGateway,
} from '@auxx/lib/payment-gateways'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/** `YYYY-MM-DD`. Shape only; the lib decides what is a sensible date. */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * The fields a person may set on a payment gateway. Deliberately thin -
 * `clearingAccountId`/`feeAccountId` name a `gl_account` instance id (task 15
 * §4 shape), and the lib refuses an unknown, inactive or wrongly-typed one at
 * write time, naming the account.
 */
const paymentGatewayFields = {
  name: z.string().min(1).max(200),
  handles: z.array(z.string().min(1).max(64)).min(1),
  clearingAccountId: z.string().min(1).max(64),
  feeAccountId: z.string().max(64).nullish(),
  settlementSource: z.enum(PAYMENT_GATEWAY_SETTLEMENT_SOURCES),
  lastSettlementAt: dateKey.nullish(),
}

export const paymentGatewaysRouter = createTRPCRouter({
  /** Every payment gateway in the org, oldest first. */
  list: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await listPaymentGateways(ctx.db, ctx.session.organizationId, {
        includeArchived: input?.includeArchived,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Add a gateway by hand.
   *
   * Gated on `ledgerControl`: the clearing account decides where cash lands,
   * the same reasoning `banking.ts`'s `bankAccount.create` gives.
   */
  create: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        name: paymentGatewayFields.name,
        handles: paymentGatewayFields.handles,
        clearingAccountId: paymentGatewayFields.clearingAccountId,
        feeAccountId: paymentGatewayFields.feeAccountId,
        settlementSource: paymentGatewayFields.settlementSource.optional(),
        lastSettlementAt: paymentGatewayFields.lastSettlementAt,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createPaymentGateway(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Edit a gateway. Gated on `ledgerControl`, same reasoning as {@link create}. */
  update: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        id: z.string().min(1),
        name: paymentGatewayFields.name.optional(),
        handles: paymentGatewayFields.handles.optional(),
        clearingAccountId: paymentGatewayFields.clearingAccountId.optional(),
        feeAccountId: paymentGatewayFields.feeAccountId,
        settlementSource: paymentGatewayFields.settlementSource.optional(),
        lastSettlementAt: paymentGatewayFields.lastSettlementAt,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      const result = await updatePaymentGateway(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        paymentGatewayId: id,
        ...patch,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Mark a gateway closed. Not a delete - a rail is not permanent (§5.1:
   * Authorize.Net closed May 2026 with a clearing balance still winding down),
   * and a closed gateway still routes its own posting history.
   */
  archive: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await archivePaymentGateway(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        paymentGatewayId: input.id,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})
