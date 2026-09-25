// apps/web/src/server/api/routers/payment-gateways.ts
//
// Payment gateways: a record carrying its own clearing account, never a role
// (plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md §5.3). Mounted
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
  linkFeed,
  listGatewayHandleCensus,
  listObservedGatewayHandles,
  listPaymentGateways,
  listUnlinkedFeeds,
  PAYMENT_GATEWAY_FEE_TREATMENTS,
  PAYMENT_GATEWAY_STATUSES,
  readClearingAccountBalance,
  readiness,
  setUpPaymentGateway,
  unlinkFeed,
  updatePaymentGateway,
} from '@auxx/lib/accounting/rails'
import { requestAccountingRecovery } from '@auxx/lib/accounting/work-items'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { calendarDaySchema } from '~/server/api/calendar-day-schema'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/** `YYYY-MM-DD`. Shape only; the lib decides what is a sensible date. */
const dateKey = calendarDaySchema

/**
 * The fields a person may set on a payment gateway. Deliberately thin -
 * `clearingAccountId`/`feeAccountId` name a `gl_account` instance id (task 15
 * §4 shape), written through `setRoleAssignment`, which refuses an unknown,
 * inactive or wrongly-typed one at write time, naming the account.
 */
const paymentGatewayFields = {
  name: z.string().min(1).max(200),
  handles: z.array(z.string().min(1).max(64)).min(1),
  clearingAccountId: z.string().min(1).max(64),
  feeAccountId: z.string().max(64).nullish(),
  // 🛑 Whether a payout entry for this rail carries a fee leg at all (brief 26
  // §4), not a label. Optional on both writes: `netted` is the lib's default and
  // migration 156 stamped it onto every record that predates the field.
  feeTreatment: z.enum(PAYMENT_GATEWAY_FEE_TREATMENTS),
  lastSettlementAt: dateKey.nullish(),
}

/** An existing chart account, or a new one minted under this name. */
const railAccountChoice = z.union([
  z.object({ accountId: z.string().min(1).max(64) }).strict(),
  z.object({ mint: z.string().trim().min(1).max(200) }).strict(),
])

export const paymentGatewaysRouter = createTRPCRouter({
  /**
   * Whether a rail can post: `clearing` row present, `bank` row present when a feed is linked,
   * and any open `payout_destination_mismatch` on its payouts (task 58 §6.2). Replaces
   * `settlementReadiness`.
   */
  readiness: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ gatewayId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await readiness(ctx.db, {
        organizationId: ctx.session.organizationId,
        gatewayId: input.gatewayId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Live processor feeds with reported activity that no rail has claimed yet, for the linker. */
  listUnlinkedFeeds: permissionProcedure(PermissionKey.ledgerView).query(({ ctx }) =>
    listUnlinkedFeeds(ctx.db, ctx.session.organizationId)
  ),

  /** Point one feed at this rail. Replaces the processor-account half of `updateSettlementSettings`. */
  linkFeed: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ gatewayId: z.string().min(1), sourceAccountId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await linkFeed(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Clear one feed's rail pointer. */
  unlinkFeed: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ sourceAccountId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await unlinkFeed(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

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
   * Every gateway handle seen on the org's own orders, with whether a record
   * already routes it.
   *
   * The lookup behind the add dialog's suggestions and the list page's
   * "routed" line. `ledgerView` like {@link list}: it reads which rails the
   * store has run, which is bookkeeping context, not a control.
   */
  observedHandles: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listObservedGatewayHandles(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * {@link observedHandles}, plus the order count and last-seen date per
   * handle (brief 26 §8 item 1).
   *
   * 🛑 A SEPARATE procedure, not a flag on {@link observedHandles}. The
   * settings list must keep reading the cheap `selectDistinct`; this one joins
   * the order's `placedAt` value as well, and it exists because a setup screen
   * needs to tell a RETIRED rail (thousands of orders, none this year) from the
   * actual alarm (orders last week, no record). `ledgerView`, same rung and
   * same reasoning as {@link observedHandles}.
   */
  handleCensus: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listGatewayHandleCensus(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * What is posted to one clearing account, so the editor can say what a
   * repoint is about to strand (brief 26 §9.1).
   *
   * ⚠️ It answers for the ACCOUNT, not for the gateway. Nothing stamps a
   * gateway onto a posting line, and a clearing account can be shared - so the
   * caller must name the account in whatever it renders, never the rail.
   *
   * `ledgerView`: it is a balance, and every other balance read on this module
   * sits on the same rung.
   */
  clearingBalance: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ glAccountId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const result = await readClearingAccountBalance(ctx.db, {
        organizationId: ctx.session.organizationId,
        glAccountId: input.glAccountId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Set a rail up in one call: mint or pick its clearing and fee accounts, write the record, map
   * its bank, link its feed (plans/accounting/tasks/100 §3.2). A bank or feed step that fails
   * after the record is written comes back in `failures`; the gateway stands.
   */
  setUp: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        name: paymentGatewayFields.name,
        handles: paymentGatewayFields.handles,
        feeTreatment: paymentGatewayFields.feeTreatment.optional(),
        /** `closed` for a rail with no recent orders; its history still routes. */
        status: z.enum(PAYMENT_GATEWAY_STATUSES).optional(),
        clearing: railAccountChoice,
        /** Null inherits the org's fee account. */
        fee: railAccountChoice.nullish(),
        bankAccountId: z.string().min(1).max(64).nullish(),
        sourceAccountId: z.string().min(1).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await setUpPaymentGateway(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ...input,
      })
      if (result.isErr()) throw result.error
      // The receipts this gateway unblocks post now, not on the next scheduled pass.
      await requestAccountingRecovery(ctx.session.organizationId)
      return result.value
    }),

  /** Edit a gateway. Gated on `ledgerControl`, same reasoning as {@link setUp}. */
  update: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        id: z.string().min(1),
        name: paymentGatewayFields.name.optional(),
        handles: paymentGatewayFields.handles.optional(),
        clearingAccountId: paymentGatewayFields.clearingAccountId.optional(),
        feeAccountId: paymentGatewayFields.feeAccountId,
        feeTreatment: paymentGatewayFields.feeTreatment.optional(),
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
