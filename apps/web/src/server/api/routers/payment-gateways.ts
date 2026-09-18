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
  createPaymentGateway,
  linkFeed,
  listGatewayHandleCensus,
  listObservedGatewayHandles,
  listPaymentGateways,
  listUnlinkedFeeds,
  mintRailAccounts,
  PAYMENT_GATEWAY_FEE_TREATMENTS,
  PAYMENT_GATEWAY_STATUSES,
  readClearingAccountBalance,
  readiness,
  unlinkFeed,
  updatePaymentGateway,
} from '@auxx/lib/accounting/rails'
import { suggestRail } from '@auxx/lib/accounting/rails/rail-catalogue'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/** `YYYY-MM-DD`. Shape only; the lib decides what is a sensible date. */
const dateKey = z.iso.date()

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
   * Mint a rail's accounts and route it, in one click (brief 26 §7.4).
   *
   * 🛑 **The composition lives HERE, not in `createPaymentGateway`.** That
   * function's own jsdoc says *"What it must NOT do: mint an account per
   * gateway"* and §7.4 keeps it true: `clearingAccountId` there names an
   * EXISTING account, and two rails sharing one stays ordinary. `mintRailAccounts`
   * is its own door; this procedure is the one place the two are put together,
   * which is what gives the wizard's create button a single call while leaving
   * both lib contracts where they were.
   *
   * ⚠️ `mintFeeAccount` is the CALLER's answer. §5's defaults are asymmetric on
   * purpose - a `netted` rail books to the shared `payment_processing_fees`
   * fallback and a `billed` rail mints its own, because *"has this rail billed
   * us this month"* is unanswerable once billed fees land in the shared account
   * - but they are the wizard's checkbox defaults, not a rule this procedure
   * may apply over whatever somebody just unticked.
   *
   * ⚠️ Two writes, not one transaction: if the gateway create refuses after the
   * mint, the accounts stand. That is the safe half to keep - they are ordinary
   * chart accounts, visible in the chart editor, and the refusal names what to
   * fix. The alternative, rolling back a chart write, is a delete on a path
   * that has no delete.
   *
   * `ledgerControl`, the rung both halves already sit on.
   */
  createForRail: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        /** Every handle this rail answers to. The spellings §8's merge grouped together. */
        handles: paymentGatewayFields.handles,
        /** The rail's display name. Defaults to the suggestion for the first handle. */
        name: paymentGatewayFields.name.optional(),
        /** Overrides the suggested clearing account name. */
        clearingAccountName: z.string().min(1).max(200).optional(),
        /** Mint a dedicated fee account as well. §5's asymmetric default is the caller's. */
        mintFeeAccount: z.boolean(),
        /** Overrides the suggested fee account name. */
        feeAccountName: z.string().min(1).max(200).optional(),
        feeTreatment: paymentGatewayFields.feeTreatment.optional(),
        /** `closed` for a rail with no recent orders (§9). Its history still routes. */
        status: z.enum(PAYMENT_GATEWAY_STATUSES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      // Suggestions only, never routing (§7.2): an unknown handle gets a titled
      // name and the safe defaults rather than a refusal.
      const suggestion = suggestRail(input.handles[0] ?? '')

      const minted = await mintRailAccounts(ctx.db, {
        organizationId,
        actorUserId: userId,
        clearingAccountName: input.clearingAccountName ?? suggestion.clearingAccountName,
        mintFeeAccount: input.mintFeeAccount,
        feeAccountName: input.feeAccountName ?? suggestion.feeAccountName,
      })
      if (minted.isErr()) throw minted.error

      const created = await createPaymentGateway(ctx.db, {
        organizationId,
        actorUserId: userId,
        name: input.name?.trim() || suggestion.name,
        handles: input.handles,
        clearingAccountId: minted.value.clearing.id,
        feeAccountId: minted.value.fee?.id ?? null,
        feeTreatment: input.feeTreatment ?? suggestion.feeTreatment,
        status: input.status,
      })
      if (created.isErr()) throw created.error
      return { gateway: created.value, accounts: minted.value }
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
        feeTreatment: paymentGatewayFields.feeTreatment.optional(),
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
