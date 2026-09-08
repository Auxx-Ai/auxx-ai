// apps/web/src/server/api/routers/banking.ts
//
// Bank accounts: the list, the editor's writes, the coverage read, removal, and
// the four feed actions - connect, reconnect, sync now, disconnect
// (plans/accounting/HANDOFF.md slots 2I and 3A, plans/accounting/ui-plan.md §2.7,
// plans/bank-connection/08-removing-a-bank-account.md §7.3).
// Mounted as `banking` in `root.ts`.
//
// 🛑 Reads are `ledgerView`; every write is `ledgerPost`. Mapping a bank account
// to a GL code decides where cash lands, which is a post-grade act even though
// it writes no posting - the same reasoning that puts the chart's own writes on
// `ledgerPost` (`accounts-settings-page.tsx`).
//
// 🛑 Every refusal reaches the browser as an `AuxxError` verbatim and is
// rendered as an `EntryBlockers` card, never a toast (HANDOFF ground rule 9).
// Nothing here re-validates what the lib already refuses: a second authority
// drifts, and replacing "the currency of a connected account comes from the
// bank" with "Could not save" throws away the only sentence that says what to
// do next.

import {
  archiveBankAccount,
  BANK_ACCOUNT_STATUSES,
  BANK_ACCOUNT_TYPES,
  createBankAccount,
  deleteBankAccount,
  disconnectBankAccountFeed,
  getBankAccount,
  listBankAccounts,
  readCoverage,
  readRemovalFacts,
  resolveRemoval,
  restoreBankAccount,
  startBankConnection,
  syncBankAccountFeed,
  updateBankAccount,
} from '@auxx/lib/banking'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'
// Slot 3D. The statement-import procedures live in their own file: three agents
// are editing this router in the same wave, and a 200-line block in the middle
// of it is a merge conflict looking for somewhere to happen.
import { bankingImportRouter } from './banking-import'

/** `YYYY-MM-DD`. Shape only; the lib decides what is a sensible date. */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * The fields a person may set on a bank account.
 *
 * Deliberately thin. `last4` is a plain string here and the lib refuses
 * anything but up to four digits with a sentence saying so, because a Zod issue
 * reads `last4: invalid` where the writer explains that `**5381` was pasted with
 * its mask still on. Same for `glAccountCode`: `resolveRoles` refuses an unknown
 * or wrongly-typed code at POST time, naming the account.
 */
const bankAccountFields = {
  name: z.string().min(1).max(200),
  institution: z.string().max(200).nullish(),
  last4: z.string().max(8).nullish(),
  type: z.enum(BANK_ACCOUNT_TYPES),
  currency: z.string().max(8).nullish(),
  glAccountCode: z.string().max(64).nullish(),
  feedStartDate: dateKey.nullish(),
}

export const bankingRouter = createTRPCRouter({
  bankAccount: createTRPCRouter({
    /**
     * Every bank account, each joined to its connector's live health.
     *
     * One read, not two. The settings page renders a status chip on every row,
     * so pairing this with a per-row `dataConnector.getStatus` would be N+1
     * round trips to draw a list. The live polling in
     * `use-connector-sync-realtime.ts` takes over for the SELECTED account only.
     */
    list: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ includeArchived: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const result = await listBankAccounts(ctx.db, {
          organizationId: ctx.session.organizationId,
          // Default false. Only the settings list's "Show archived" toggle and
          // the picker - which has to keep rendering an archived account that is
          // still some record's current value - ever ask for the other answer.
          includeArchived: input?.includeArchived ?? false,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    get: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const result = await getBankAccount(ctx.db, {
          organizationId: ctx.session.organizationId,
          bankAccountId: input.id,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * What this account has data for, and what it does not.
     *
     * A separate procedure rather than a field on the list row: deriving gaps
     * reads every `bank_transaction` date on the account, which is the one
     * unbounded query in this router. Paying it per selected row is fine; paying
     * it for every row on every render of the list is not.
     */
    coverage: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const result = await readCoverage(ctx.db, {
          organizationId: ctx.session.organizationId,
          bankAccountId: input.id,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** Add an account by hand. Always `manual`; a connector is never claimed here. */
    create: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          name: bankAccountFields.name,
          institution: bankAccountFields.institution,
          last4: bankAccountFields.last4,
          type: bankAccountFields.type.optional(),
          currency: bankAccountFields.currency,
          glAccountCode: bankAccountFields.glAccountCode,
          feedStartDate: bankAccountFields.feedStartDate,
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await createBankAccount(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.userId,
          ...input,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Edit an account.
     *
     * `status` is in here because Disconnect is an update, not a delete: it sets
     * `disconnected` and keeps every row, since a coded and posted bank line is
     * the source document of a journal entry.
     */
    update: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          id: z.string().min(1),
          name: bankAccountFields.name.optional(),
          institution: bankAccountFields.institution,
          last4: bankAccountFields.last4,
          type: bankAccountFields.type.optional(),
          currency: bankAccountFields.currency,
          glAccountCode: bankAccountFields.glAccountCode,
          feedStartDate: bankAccountFields.feedStartDate,
          status: z.enum(BANK_ACCOUNT_STATUSES).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input
        const result = await updateBankAccount(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.userId,
          bankAccountId: id,
          ...patch,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * What removing this account would do, for the confirm dialog.
     *
     * `ledgerView`, because it reads and decides nothing. It answers the verb,
     * what a delete would take with it, how many unreviewed lines an archive
     * would exclude, and which rules a delete would leave inert.
     */
    removalPreview: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const facts = await readRemovalFacts(ctx.db, {
          organizationId: ctx.session.organizationId,
          bankAccountId: input.id,
        })
        if (facts.isErr()) throw facts.error
        return { facts: facts.value, ...resolveRemoval(facts.value) }
      }),

    /**
     * Remove a bank account.
     *
     * 🛑 **ONE procedure, not two, and the gate runs HERE.** A pristine account
     * is deleted for real; anything a journal entry has ever come off is
     * archived. The client must not be the one to decide which verb applies: a
     * client that decided could race a sync landing a transaction between the
     * preview it read and the call it made, and would then ask for a hard delete
     * of an account whose rows are now a posting's source documents.
     *
     * The preview above exists only so the button can read "Delete" or "Archive"
     * and the confirm text can name the right consequences. It is never the
     * authority.
     */
    remove: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const facts = await readRemovalFacts(ctx.db, {
          organizationId: ctx.session.organizationId,
          bankAccountId: input.id,
        })
        if (facts.isErr()) throw facts.error

        const params = {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.userId,
          bankAccountId: input.id,
        }
        if (resolveRemoval(facts.value).verb === 'delete') {
          const result = await deleteBankAccount(ctx.db, params)
          if (result.isErr()) throw result.error
          return { verb: 'delete' as const, ...result.value, excluded: 0 }
        }
        const result = await archiveBankAccount(ctx.db, params)
        if (result.isErr()) throw result.error
        return { verb: 'archive' as const, ...result.value }
      }),

    /**
     * Put an archived account back.
     *
     * ⚠️ It does not reconnect the feed - the account was released at Stripe, so
     * the only way back to a live one is a fresh authentication at the bank - and
     * it does not un-exclude the lines the archive swept, which stay undoable one
     * at a time in the review queue.
     */
    restore: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await restoreBankAccount(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.userId,
          bankAccountId: input.id,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),
  }),

  /**
   * Statement file import (slot 3D). See `./banking-import.ts`.
   *
   * The ingest path a vendor cannot switch off: Stripe FC reaches back 180 days,
   * an institution may not be covered at all, and a dead feed mid-close still
   * has to be finished (plans/bank-connection/05-file-import.md §1).
   */
  bankingImport: bankingImportRouter,

  /**
   * Start a bank connection.
   *
   * 🛑 It returns a URL to the platform's own `hosted-provision` start route, and
   * the browser branches on what THAT returns (a redirect, or JSON carrying an
   * embed config) - never on which provider it is talking to (decision **B13**).
   * The acceptance test is that a second bank aggregator of the same shape needs
   * zero code changes here, only a `PlatformProviderDef`.
   *
   * Why a URL rather than calling `handler.start` from tRPC: the start route is
   * where the one-shot Redis state token is minted and session-guarded, and it is
   * the same door the redirect providers already use. Two doors onto one flow is
   * how one of them ends up without the guard.
   *
   * `ledgerPost`, not `ledgerView`: connecting a bank decides where cash comes
   * from.
   */
  connect: permissionProcedure(PermissionKey.ledgerPost).mutation(async () => {
    return startBankConnection()
  }),

  /**
   * Re-authenticate a bank whose feed has died.
   *
   * The SAME flow as `connect`, deliberately: Financial Connections has no
   * "repair this account" endpoint, so a reconnect is a fresh authentication that
   * lands on the account the user already has. `provisionBankFeed` is idempotent
   * on the credential, so it re-arms the existing connector and `bank_account`
   * instead of standing a second feed up beside the first - which would double
   * every transaction in the review queue.
   */
  reconnect: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async () => {
      return startBankConnection()
    }),

  /**
   * Pull now.
   *
   * 🛑 Refuses on a `disconnected` connector, and the refusal is the point (#2051).
   * A disconnected connector is structurally indistinguishable from a healthy one -
   * it keeps its credential and its fully-configured streams - so every
   * config-shaped predicate says yes. One "Sync now" click on one moves it to
   * `error`, which discards the Disconnected banner AND puts it outside every
   * repair path, so reconnecting no longer fixes it.
   */
  sync: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await syncBankAccountFeed(ctx.db, {
        organizationId: ctx.session.organizationId,
        bankAccountId: input.id,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Stop the feed and release the account at Stripe.
   *
   * 🛑 Two things happen and neither is a delete. The connector goes
   * `disconnected` and the `bank_account` with it, and EVERY transaction stays -
   * a coded and posted bank line is the source document of a journal entry
   * (plans/bank-connection/02 §5.1). Separately the account is released at Stripe,
   * because a linked account keeps billing 30c per month until it is, invisibly,
   * until somebody reads an invoice (open question **S4**).
   */
  disconnect: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await disconnectBankAccountFeed(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        bankAccountId: input.id,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})
