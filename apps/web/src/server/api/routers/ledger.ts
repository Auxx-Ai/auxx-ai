// apps/web/src/server/api/routers/ledger.ts

import { schema } from '@auxx/database'
import { getCachedEntityDefId, getCachedInstalledApps } from '@auxx/lib/cache'
import { BadRequestError, UnprocessableEntityError } from '@auxx/lib/errors'
import { getPaymentAccount } from '@auxx/lib/money'
// The naming catalogue is PURE and client-safe (brief 26 §7.2), so it lives on
// its own leaf subpath and is imported from there rather than through the
// `payment-gateways` barrel, which reaches Drizzle and the org cache.
import { suggestRail } from '@auxx/lib/payment-gateways/rail-catalogue'
import { PermissionKey } from '@auxx/lib/permissions'
import {
  ACCOUNT_ROLES,
  accountingOpeningPolicySchema,
  activateAccountingBookConnection,
  assertAccountingSetupUnfrozen,
  buildExportBatches,
  CHART_PACK_KEYS,
  confirmSuggestedIdentities,
  createAndLinkProviderAccount,
  createChartAccount,
  createJournalEntry,
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
  discardDraftPosting,
  discardJournalEntry,
  EXPORT_AVENUES,
  enqueueProviderSync,
  GL_ACCOUNT_SUBTYPES,
  GL_ACCOUNT_TYPES,
  getJournalEntry,
  getPosting,
  importChartFromProvider,
  listAccountIdentities,
  listChartAccounts,
  listChartAccountUsage,
  listClosePeriods,
  listExportBatches,
  listJournalEntries,
  listPostings,
  listPostingsForSource,
  listRoleMap,
  listRoleSources,
  mintRailAccounts,
  PROVIDER_SYNC_RUN_STALE_MS,
  PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
  postDraft,
  postJournalEntry,
  previewJournalEntry,
  readAccountingBookConnectionStatus,
  readCloseBlockers,
  readExportSettings,
  readLatestPostingsByType,
  readLedgerSummary,
  readProviderSyncRunState,
  readTrialBalance,
  releaseExportBatches,
  removeChartAccount,
  repairAccountingBookConnection,
  resolveAccountingProvider,
  resolvePeriodLock,
  restoreChartAccount,
  retryExportBatch,
  reverseEntries,
  reverseEntry,
  reverseJournalEntry,
  rollbackExportBatch,
  type SaveMappingRow,
  saveRoleAssignments,
  sendExportBatch,
  setAccountIdentity,
  setLockedThrough,
  setRoleAssignment,
  syncProviderSyncScheduler,
  updateChartAccount,
  updateJournalEntry,
  verifyBooksBalance,
} from '@auxx/lib/postings'
// The comparison itself is PURE (brief 20 §8.2), so it lives on the client-safe
// leaf beside the other planners and is imported from there rather than being
// re-exported through the server barrel for one call site.
import {
  EXPORT_BATCH_STATES,
  type ProviderSyncScheduleConfig,
  planProviderAgreement,
} from '@auxx/lib/postings/client'
import {
  clearRecurringJournalSchedule,
  listRecurringJournalTemplates,
  setRecurringJournalSchedule,
} from '@auxx/lib/postings/recurring-journals'
import { recurrencePatternSchema } from '@auxx/lib/recurrence'
import { seedChartAccounts, seedChartPacks, seedDefaultPaymentGateways } from '@auxx/lib/seed'
import { getOrganizationSetting, updateOrganizationSetting } from '@auxx/lib/settings'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requestAuditContext } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, permissionProcedure } from '~/server/api/trpc'

/**
 * The general ledger's posting surface (plans/money/tasks/10-the-poster.md §6).
 *
 * **Manual, synchronous, and deliberately so.** For the cutover the trigger is a
 * person clicking Post - roughly 30 entries a month - so a cron buys nothing at
 * that volume and costs the ability to look at an entry before it reaches the
 * financial statements. A human is watching and wants the answer, so these are
 * plain procedures rather than jobs. Event triggers, an hourly scheduler and an
 * approval-gated workflow node come later, and only after two closes have agreed
 * with a hand reconciliation.
 *
 * | procedure         | gate         |
 * | ----------------- | ------------ |
 * | `failedExports` | `ledger.view` |
 * | `retryExport` | `ledger.post` |
 * | `syncExports` | `ledger.post` |
 * | `unsyncExports` | `ledger.control` |
 * | `verifyBalance`   | `ledger.view` |
 * | `reverse`         | `ledger.post` |
 * | `reverseMany`     | `ledger.post` |
 * | `setLockedThrough` | `ledger.control` |
 * | `syncProviderLedger` | `ledger.control` |
 * | `providerSyncRunState` | `ledger.view` |
 *
 * `ledger` is its own L2 area rather than a corner of `billing`: `billing`
 * governs what auxx charges this org, this governs what the org's own books say
 * about its money, and the two are held by different people. See
 * `PERMISSION_AREAS[Area.ledger]`.
 *
 * ## Why nothing here maps a status onto an HTTP error
 *
 * `postEntry` and `reverseEntry` never throw. A closed period, an unmapped
 * account role, an unbalanced entry and a provider that refused the push all
 * come back as a typed {@link PostResult} status, and every one of them is
 * something the UI RENDERS - a setup problem, a period to reopen, a role to map
 * - not a 500 to swallow. So these mutations return the result verbatim and let
 * the caller branch on `status`. Collapsing `period_closed` into a `TRPCError`
 * would throw away `docNumber`, `failureClass` and `retryable`, which is the
 * whole of what the operator needs to decide what to do next.
 *
 * What DOES throw is everything upstream of the poster: `resolvePeriodLock`
 * fails closed on a malformed `ledger.lockedThroughMonth` setting, `buildEntry`
 * refuses a draft that does not balance, and `periodMonth` rejects a malformed
 * bound. All three throw `AuxxError` subclasses, which `auxxErrorMiddleware`
 * maps to the right status. Nothing here catches them - a `try/catch` that
 * rethrew would have to guard with `isAuxxError(e)` from `~/server/api/trpc`,
 * never `e instanceof TRPCError`, or the 422 flattens into a 500.
 */
/**
 * An accounting MONTH, `'2026-08'`.
 *
 * Validated here only for SHAPE. Whether the month is closable - after the
 * cutoff, not already locked, with something in it to close - is decided by
 * `readCloseBlockers`, which answers with one item per piece of outstanding
 * work, naming the exact row to fix. Restating any of that in Zod would give the same
 * input two authorities and the worse error would win.
 */
const monthKey = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, 'periodKey must be a YYYY-MM month'),
})

/**
 * The same month, optional.
 *
 * Only `listPostings` takes this: an org whose accounting is finalized with a
 * cutoff in the future resolves NO month, and the ledger page's Entries section
 * is the only door to a manual journal entry. A required month there hid every
 * posting on exactly the screen somebody opens to find one. Absent means "the
 * whole ledger"; a malformed value is still refused.
 */
const optionalMonthKey = z.object({
  periodKey: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'periodKey must be a YYYY-MM month')
    .optional(),
})

/**
 * One line of a journal-entry DRAFT, as the drawer stores it.
 *
 * 🛑 `amountMinor` is INTEGER MINOR UNITS. Dollars never cross this wire:
 * `toMinorUnits` from `@auxx/lib/postings/client` is the single conversion and
 * it runs in the browser, at the `CurrencyInput` boundary. Zod checks that it is
 * a number and no more - `buildManualEntry` refuses a zero, a negative and a
 * fraction of a cent, and it names the ROW while doing it, which a Zod issue
 * cannot.
 */
const journalEntryLine = z.object({
  /**
   * The `gl_account` instance id out of this org's own chart (task 15: the id
   * is the identity, the code is a label - one that may not exist at all once
   * it is optional). A person picks a specific account by id, never by code.
   */
  glAccountId: z.string().min(1),
  direction: z.enum(['debit', 'credit']),
  /** Integer minor units, > 0. The debit/credit column carries the sign. */
  amountMinor: z.number(),
  memo: z.string().max(1000).optional(),
  /**
   * Who this line is attributable to, when it names a receivable or payable
   * account (brief 13 §1.4). Optional everywhere; the only refusal on an
   * empty counterparty happens at QuickBooks export time, never on save.
   */
  counterpartyType: z.enum(['customer', 'vendor']).optional(),
  counterpartyId: z.string().min(1).optional(),
})

export const ledgerRouter = createTRPCRouter({
  bookConnectionStatus: permissionProcedure(PermissionKey.ledgerControl).query(({ ctx }) =>
    readAccountingBookConnectionStatus(ctx.db, ctx.session.organizationId)
  ),
  repairBookConnection: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        connectionId: z.string().min(1),
        credentialId: z.string().min(1),
        expectedActiveConnectionId: z.string().min(1).nullable(),
        reason: z.string().trim().min(1).max(2000),
      })
    )
    .mutation(({ ctx, input }) =>
      repairAccountingBookConnection(ctx.db, {
        ...input,
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
      })
    ),
  activateBookConnection: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        credentialId: z.string().min(1),
        expectedActiveConnectionId: z.string().min(1).nullable(),
        openingPolicy: accountingOpeningPolicySchema,
      })
    )
    .mutation(({ ctx, input }) =>
      activateAccountingBookConnection(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        credentialId: input.credentialId,
        expectedActiveConnectionId: input.expectedActiveConnectionId,
        exportFromDate: input.openingPolicy.exportFromDate,
        openingPolicy: input.openingPolicy,
      })
    ),

  /**
   * Back out a posted entry with a second, opposite one.
   *
   * There is no edit and no void: the reversal is its own `GlPosting` row
   * carrying `reversesId`, and the original flips to `reversed` in the same
   * transaction. Nothing about the original provider entry is touched, so the
   * provider's register ends up holding both halves - which is what a bookkeeper
   * expects to see and what makes the pair auditable.
   *
   * Gated on `ledgerPost`, not on a separate key: a reversal IS a post, it lands
   * in the same books, and someone trusted to write to the ledger is exactly
   * who should be able to correct it.
   */
  reverse: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        glPostingId: z.string().min(1),
        memo: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const lock = await resolvePeriodLock(organizationId)

      return reverseEntry(ctx.db, {
        organizationId,
        glPostingId: input.glPostingId,
        actorUserId: userId,
        lock,
        memo: input.memo,
      })
    }),

  /**
   * Reverse several postings in one press - the sync queue's bulk Reverse.
   *
   * 🛑 A LEDGER operation, unlike `unsyncExports` beside it in the same bulk
   * bar. Every accepted row writes a NEW entry into the books and flips its
   * original to `reversed`; nothing is edited and nothing is deleted, but an
   * effect-backed original's accepted effect IS released so its source can be
   * posted again (plans/accounting/tasks/done/62-correcting-an-effect-backed-posting.md).
   * The copy already in the provider is left exactly where it is
   * (plans/accounting/tasks/60-un-syncing-from-the-provider.md E1/E2).
   *
   * One outcome per posting and never a throw: a locked period, an entry that is
   * not `posted` and an unmapped account all arrive as that row's `refused`
   * message and land the rest of the selection.
   *
   * ⚠️ Capped at **100**, not `syncExports`' 500. A release stamps a column;
   * each of these is a full `postEntry` - claim, resolve against the chart,
   * write lines and effects - run sequentially inside the request.
   */
  reverseMany: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        glPostingIds: z.array(z.string().min(1)).min(1).max(100),
        memo: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const lock = await resolvePeriodLock(organizationId)

      return reverseEntries(ctx.db, {
        organizationId,
        glPostingIds: input.glPostingIds,
        actorUserId: userId,
        lock,
        memo: input.memo,
      })
    }),

  /**
   * Every month from the accounting cutoff to now, with its state - the
   * console's period strip.
   *
   * Derived from `GlPosting` + `accounting.cutoffPeriod` +
   * `ledger.lockedThroughMonth`, with **no new table**. Task 13 deferred the
   * `gl_close_period` entity pair and this is why that deferral holds: there is
   * nothing for a table to hold that the ledger does not already answer.
   *
   * An organization that has not finished setup gets an EMPTY strip rather than
   * an error. "You have not started" is not a failure, and the module home
   * renders the setup checklist in that case.
   */
  periods: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listClosePeriods(ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Declare the books shut through one month, or reopen back to the month
   * before it. This is the ONLY door onto `ledger.lockedThroughMonth`.
   *
   * Gated on `ledgerControl`, not `settingsManage` (plans/accounting/tasks/
   * 12-accountant-permissions.md §0.4/§4.4). Closing a period is the single most
   * characteristic act of an accountant, and the generic settings door would
   * have handed them every organization setting in the product to get it. See
   * `setting.ts`'s `ROUTER_OWNED_ORG_SETTING_KEYS`, which refuses this key on
   * the generic door so this stays the only path.
   *
   * `periodKey: null` reopens everything - "nothing is closed" - which is
   * `resolvePeriodLock`'s own reading of an unset value.
   */
  setLockedThrough: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        periodKey: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .nullable(),
      })
    )
    .use(notDemo('lock or unlock an accounting period'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const key = 'ledger.lockedThroughMonth' as const

      // Mirrors `setting.updateOrganizationSetting`'s guard: harmless today
      // (this key is not in `FROZEN_SETUP_SETTING_KEYS`), but the same
      // authority should apply if that ever changes.
      await assertAccountingSetupUnfrozen(organizationId, [key])

      await setLockedThrough(ctx.db, {
        organizationId,
        periodKey: input.periodKey,
        actorUserId: ctx.session.user.id,
        ...requestAuditContext(ctx.headers),
        sessionId: ctx.session.id ?? null,
      })

      return { success: true }
    }),

  /**
   * What stands between one month and its close.
   *
   * 🛑 A close POSTS NOTHING since MIGRATION step 5: every inventory document
   * posted its own entry when it was written, so all a close can do is check -
   * is every movement in an entry, and does the ledger tie to the movements.
   * The items are the answer and the console renders one actionable row each.
   */
  closeBlockers: permissionProcedure(PermissionKey.ledgerView)
    .input(monthKey)
    .query(async ({ ctx, input }) => {
      return readCloseBlockers(ctx.db, {
        organizationId: ctx.session.organizationId,
        periodKey: input.periodKey,
      })
    }),

  /**
   * One posting, with its lines and its stored draft - the posting drawer's
   * single read.
   *
   * 🛑 The `draft` comes back as it was STORED, assertions included. The
   * roll-forward panel renders `assertions.before` / `assertions.after` from it
   * and must never re-derive them from the subledger: a posted entry asserts
   * what the world looked like when it was posted, and a reversal swaps the pair
   * rather than recomputing it. Re-reading would make a reversed month render as
   * though it had never been reversed.
   */
  get: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await getPosting(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Every `GlPostingSource` row this posting carries - the posting drawer's
   * Links list (accounting migration step 1c).
   *
   * A plain scoped select rather than a `postings/` lib read: nothing upstream
   * of this needs the OTHER direction (`listPostingsForSource` walks
   * `sourceKind`/`sourceId` → posting), and adding a one-off reverse read there
   * for a single drawer would be a lib export with one caller.
   */
  postingSources: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ glPostingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: schema.GlPostingSource.id,
          sourceKind: schema.GlPostingSource.sourceKind,
          sourceId: schema.GlPostingSource.sourceId,
          linkRole: schema.GlPostingSource.linkRole,
          occurrence: schema.GlPostingSource.occurrence,
        })
        .from(schema.GlPostingSource)
        .where(
          and(
            eq(schema.GlPostingSource.organizationId, ctx.session.organizationId),
            eq(schema.GlPostingSource.glPostingId, input.glPostingId)
          )
        )
    }),

  /**
   * Every posting role and the account it resolves to, plus every store and
   * rail it may be scoped to.
   *
   * Returns a row for EVERY role in `ACCOUNT_ROLES`, mapped or not: the role map
   * is a complete checklist, and a list of only the rows that happen to exist
   * could never show what is missing. Each role's `overrides` carries its
   * per-store rows and `railOverrides` its per-rail rows (with a currency
   * sub-row where one exists) - `sources` is what `listRoleSources` offers a
   * picker for either axis (task 58 §6.1), stores from evidence, rails from the
   * org's own live `payment_gateway` records.
   */
  roleMap: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const [result, sources] = await Promise.all([
      listRoleMap(ctx.db, organizationId),
      // The stores and rails a scopable role may be pointed at (task 47 §7.4,
      // task 58 §6.1). On the same read as the roles because the tree renders
      // them together, and a second round trip would let the two arrive out of
      // step - a role showing an override for a store or rail the picker has
      // not heard of yet.
      listRoleSources(ctx.db, organizationId),
    ])
    if (result.isErr()) throw result.error
    return { roles: result.value, sources }
  }),

  /**
   * Point one role at an account, or mark it unused.
   *
   * Gated on `ledgerControl` rather than `ledgerPost`: this decides where real
   * money lands, not merely that it moves, so it belongs with the people
   * trusted to control the ledger's structure, not everyone trusted to post to
   * it.
   */
  setRoleAssignment: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        role: z.enum(Object.values(ACCOUNT_ROLES) as [string, ...string[]]),
        glAccountId: z.string().min(1).nullish(),
        markedUnused: z.boolean().optional(),
        /**
         * Scope this edit to one connection (task 47 §7.3). Every refusal that
         * belongs to it - a role that cannot be scoped, a connection that is not
         * this org's, a revenue role pointed at a merchant account - is
         * `setRoleAssignment`'s, and its sentence is what reaches the screen.
         */
        sourceAccountId: z.string().min(1).nullish(),
        /** Drop this connection's override so it follows the default again. */
        useDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await setRoleAssignment(ctx.db, {
        organizationId,
        role: input.role,
        glAccountId: input.glAccountId,
        markedUnused: input.markedUnused,
        sourceAccountId: input.sourceAccountId,
        useDefault: input.useDefault,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Apply the Mapping tab's whole staged batch in one call (59 §2.4): every
   * edit goes through `setRoleAssignment`'s own validation, in one transaction,
   * so one refused row refuses the batch and names itself - never a partial
   * save the screen would have to reconcile against what it just rendered.
   *
   * Same `ledgerControl` rung as `setRoleAssignment`, for the same reason.
   */
  saveMapping: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z
        .object({
          role: z.enum(Object.values(ACCOUNT_ROLES) as [string, ...string[]]),
          /** `null` is the org default; a store or a rail scopes the edit (58 §3). */
          scope: z
            .union([
              z.object({ store: z.string().min(1) }).strict(),
              z.object({ rail: z.string().min(1) }).strict(),
            ])
            .nullable(),
          /** Only meaningful beside `scope: { rail }` - a settlement currency. */
          currency: z.string().min(1).nullish(),
          /** An account id, or one of the two sentinels the row's picker offers beside one. */
          value: z.string().min(1),
        } satisfies Record<keyof SaveMappingRow, z.ZodTypeAny>)
        .array()
        .min(1)
    )
    .mutation(async ({ ctx, input }) => {
      const result = await saveRoleAssignments(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        rows: input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The organization's chart of accounts - every non-archived `gl_account`. */
  chartAccounts: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // 🛑 Archived rows are opt-IN, and only the settings list opts in. Every
      // other caller of this query feeds a picker or a preview, where a removed
      // account is an account money must not land in.
      const result = await listChartAccounts(ctx.db, ctx.session.organizationId, {
        includeArchived: input?.includeArchived,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * How many posted lines landed on each account, keyed on `glAccountId` (task 15).
   *
   * Read by the Chart of accounts tab alone. A posting line stores the
   * account's id with no foreign key, so a deleted account still reports its
   * true count - renumbering an account no longer affects this number at all.
   */
  chartAccountUsage: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listChartAccountUsage(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * The `G19` account map: every account in the org's chart, the account it is
   * mapped to in the connected accounting system, and what the matcher would
   * suggest for the ones without a mapping.
   *
   * ⚠️ **This one reaches the provider**, unlike every other read on this
   * router - it fetches the connected system's chart of accounts over the app
   * Lambda. Expect it to be slow relative to its neighbours, and do not put it
   * behind a component that renders on every page.
   *
   * An org with nothing connected gets its own chart back with every row
   * `unmapped` and no provider accounts, which is `P1`'s supported
   * configuration rather than an error.
   */
  accountMap: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listAccountIdentities(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Confirm that one of the org's accounts IS one account in the connected
   * system, or withdraw that confirmation by sending a null id.
   *
   * Gated on `ledgerControl` for `setRoleAssignment`'s reason: this decides
   * which external account real money lands in, so it belongs with the people
   * trusted to control the ledger's structure rather than everyone trusted to
   * post to it.
   */
  setAccountIdentity: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        glAccountId: z.string().min(1),
        providerAccountId: z.string().min(1).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await setAccountIdentity(ctx.db, {
        organizationId: ctx.session.organizationId,
        glAccountId: input.glAccountId,
        providerAccountId: input.providerAccountId,
        actorUserId: ctx.session.userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Create the counterpart of one of our accounts in the connected system, then
   * link the two - the seam run BACKWARDS.
   *
   * The accounts auxx creates itself (a clearing account per card rail, the
   * role-bearing core) exist on one side only, so the matcher has nothing to
   * offer for them and {@link setAccountIdentity} has nothing to point at. This
   * is how they stop blocking the export without somebody retyping each one
   * into QuickBooks by hand.
   *
   * Same rung as `setAccountIdentity` and for a stronger version of its reason:
   * this does not only decide which external account real money lands in, it
   * ADDS that account to somebody's books. `accountMap.canCreateProviderAccounts`
   * says whether the connected system can be asked at all.
   */
  createProviderAccount: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ glAccountId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await createAndLinkProviderAccount(ctx.db, {
        organizationId: ctx.session.organizationId,
        glAccountId: input.glAccountId,
        actorUserId: ctx.session.userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Confirm every suggestion at once - the wizard's "accept all" action.
   *
   * 🛑 Still a human confirmation under `G19`, not an automatic mapping: the
   * person has been shown every proposed pairing and the reason for it, and this
   * is them agreeing to the set. Nothing calls it on connect, and nothing may.
   *
   * Reports partial success rather than rolling back. Twenty good mappings and
   * one refusal is a better outcome than none, and the refusals come back named
   * so the screen can show which.
   */
  confirmSuggestedAccounts: permissionProcedure(PermissionKey.ledgerControl).mutation(
    async ({ ctx }) => {
      const result = await confirmSuggestedIdentities(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }
  ),

  /**
   * Write the requested chart PACKS, and point each role at the account that
   * fulfils it (brief 16 §1.5).
   *
   * `packs` defaults to `['core']`, and `core` is walked whether or not it is
   * named: a bare `provisionChart()` - what the wizard's button sent before
   * the pack picker existed - still means the core, and the picker and the
   * Roles tab's Add accounts action both name their packs explicitly. A
   * pack's own `requires` is expanded transitively before the walk runs, so
   * `{ packs: ['purchasing'] }` also lands `inventory`.
   *
   * ── Why this is a BUTTON and not part of creating an organization ──
   *
   * `gl_account`'s DEFINITION ships with every org (`SYSTEM_ENTITIES`), but its
   * ROWS do not, deliberately: most orgs never open the accounting module, and
   * a chart nobody asked for is a table everybody has to scan. Provisioning is
   * the first step of setting accounting up, so it lives where somebody has
   * said they want accounting.
   *
   * 🛑 It also closes a real hole. `seedChartPacks`' only other caller is
   * entity migration 108, which reaches production through the DataMigration
   * ledger - and `DataMigration.id` is the PRIMARY KEY, one global row, no
   * `organizationId`. Once 108 is `applied` it never runs again, so **every org
   * created after that deploy would have had a def, no accounts, and every core
   * role unmapped with no way to fix it.** This is that way.
   *
   * Safe to press twice, for any set of packs: the seed is idempotent on `code`
   * and its assignments are `ON CONFLICT (organizationId, role) DO NOTHING`, so
   * a second press over an already-provisioned pack reports `created: 0` and
   * cannot disturb an account or a mapping somebody has edited. That is
   * `seedChartPacks`' rules 1, 3 and 4, and they are the whole reason this can
   * be offered as a button at all - and the whole reason the Roles tab's Add
   * accounts action can re-walk a `partial` pack without asking which rows are
   * already there.
   */
  provisionChart: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      // Brief 16 §1.5. The outer `.default` keeps a bare `provisionChart()`
      // meaning the core, which is what the wizard's button sent before the
      // pack picker existed; the picker and the Roles tab's Add accounts both
      // name their packs explicitly.
      z
        .object({ packs: z.array(z.enum(CHART_PACK_KEYS)).default(['core']) })
        .default({ packs: ['core'] })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const glAccountDefId = await getCachedEntityDefId(organizationId, 'gl_account')
      if (!glAccountDefId) {
        throw new UnprocessableEntityError(
          'This organization has no gl_account definition, so there is nothing to seed a chart into. Run the entity migrations.',
          { organizationId }
        )
      }

      const chart = await seedChartPacks(ctx.db, organizationId, glAccountDefId, input.packs)

      // Task 13 §5.3: the one default `payment_gateway` record. Runs AFTER the
      // chart on purpose - the clearing account it points at (`clearing`)
      // only exists once the chart above has just created or confirmed it.
      // Brief 16 §1.5 ties it to the `card_rail` pack; gated on the WALKED
      // packs, not the requested ones, so `requires` expansion is honoured
      // (though nothing requires `card_rail` today, so the two currently agree).
      const paymentGateways = chart.packs.includes('card_rail')
        ? await seedDefaultPaymentGateways(ctx.db, organizationId)
        : null

      return { ...chart, paymentGateways }
    }),

  /**
   * Adopt named accounts from the catalogue - the Chart tab's From catalogue
   * picker (brief 16 §3.2), which selects ACCOUNTS where `provisionChart`
   * selects packs.
   *
   * 🛑 A pack is not a fine enough unit for this door. "Add Deferred Revenue"
   * is a reasonable thing to want, and `provisionChart(['prepayments'])` would
   * land Customer Deposits alongside it - an account nobody asked for, on a
   * screen whose whole job is showing what the chart contains.
   *
   * 🛑 Codes are validated against the catalogue and an unknown one is
   * REFUSED, naming itself. The picker only ever sends codes it rendered, so an
   * unknown code means the client and this deploy disagree about what the
   * catalogue is; creating an account from a code with no catalogue row behind
   * it would invent a name, a type and a role out of nothing.
   *
   * Same `ledgerControl` rung as `provisionChart`, for the same reason: an
   * account carrying a role decides where real money lands. And safe to press
   * twice for the same reason - `seedChartAccounts` keeps all four rules.
   */
  adoptChartAccounts: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ codes: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const glAccountDefId = await getCachedEntityDefId(organizationId, 'gl_account')
      if (!glAccountDefId) {
        throw new UnprocessableEntityError(
          'This organization has no gl_account definition, so there is nothing to seed a chart into. Run the entity migrations.',
          { organizationId }
        )
      }

      const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((account) => [account.code, account]))
      const unknown = input.codes.filter((code) => !byCode.has(code))
      if (unknown.length > 0) {
        throw new BadRequestError(
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is not an account' : 'are not accounts'} in the catalogue.`,
          { organizationId, unknown }
        )
      }

      // De-duplicated: a code sent twice would be filtered to one `missing` row
      // anyway, but `skipped` is reported to the reader and double-counting it
      // would say a code was already there when it was merely named twice.
      const accounts = [...new Set(input.codes)].map(
        (code) => byCode.get(code) as DefaultChartAccount
      )

      return seedChartAccounts(ctx.db, organizationId, glAccountDefId, accounts, {
        source: 'catalogue',
      })
    }),

  /**
   * Import the connected provider's chart of accounts as the org's own
   * (brief 16 §2). Creates only what the org lacks, sets each new account's
   * identity, assigns the unambiguous roles as `suggested`, and adds the
   * role-bearing core accounts the provider has no counterpart for.
   *
   * Same rung as `provisionChart`: this decides where money lands.
   * `refreshOnly` is the Chart tab's door and never creates the missing core.
   */
  importChartFromProvider: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ refreshOnly: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await importChartFromProvider(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        refreshOnly: input.refreshOnly,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Which card rails this org already has, so the wizard can pre-check the
   * `card_rail` pack (brief 16 §3.2). Facts about the org, not switches: a
   * Stripe Connect account is the read the payouts sync makes, and the Shopify
   * app is the `installedApps` cache. Nothing provisions off either (16 §3.3).
   */
  paymentRailsPresent: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const [account, installedApps] = await Promise.all([
      getPaymentAccount(organizationId),
      getCachedInstalledApps(organizationId),
    ])
    return {
      stripeConnect: Boolean(account?.stripeAccountId),
      shopify: installedApps.some((installed) => installed.app.slug === 'shopify'),
    }
  }),

  /**
   * Add one account to the org's chart.
   *
   * ── Why these live on `ledgerPost` and not on the generic record path ──
   *
   * 🛑 `record.create` / `record.update` are `capabilityProcedure` and assert the
   * RECORDS capability for the definition. Routing the chart through them would
   * hand "which account does `grni` resolve to" to anyone with records-Full and
   * ledger-None - and a renumber there is undetectable downstream, because the
   * resulting entry still balances. Gated on `ledgerControl`, not `ledgerPost`:
   * `setRoleAssignment` above already made this call for the same reason - this
   * decides where real money lands, which is a rung above ordinary posting.
   *
   * `gl_account` therefore stays `isVisible: false` and this is its only door.
   *
   * The refusals are the lib's, verbatim - see `postings/chart-write.ts`. Zod
   * checks structure only, for the reason `postingLine` gives at the top of this
   * file: two authorities over one input, and the worse message wins.
   */
  chartAccountCreate: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        /**
         * Optional (task 15 §5): a chart imported from a provider that ships
         * with numbering off, or one a person keeps by name alone, has no
         * code at all. The lib refuses a blank code the same as an absent one.
         */
        code: z.string().max(32).optional(),
        name: z.string().min(1),
        accountType: z.enum(GL_ACCOUNT_TYPES),
        isActive: z.boolean().optional(),
        subtype: z.enum(GL_ACCOUNT_SUBTYPES).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await createChartAccount(ctx.db, {
        ...input,
        organizationId,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Change one account. Only the keys sent are written.
   *
   * `code` and `name` are unconditional (`G7`); `accountType` and `isActive` are
   * refused when a role still posts to the account, naming it. `code: null` or
   * a blank string clears it (task 15 §5) - the account id is the identity, so
   * removing the label leaves a perfectly postable account.
   */
  chartAccountUpdate: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        id: z.string().min(1),
        code: z.string().max(32).nullable().optional(),
        name: z.string().optional(),
        accountType: z.enum(GL_ACCOUNT_TYPES).optional(),
        isActive: z.boolean().optional(),
        subtype: z.enum(GL_ACCOUNT_SUBTYPES).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { id, ...values } = input
      const result = await updateChartAccount(ctx.db, {
        ...values,
        organizationId,
        accountId: id,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Take one account out of the chart.
   *
   * ARCHIVES - the lib module carries the three reasons there is no hard delete.
   * Refused while a role still posts to the account.
   */
  chartAccountRemove: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await removeChartAccount(ctx.db, {
        organizationId,
        accountId: input.id,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Put a removed account back. Same `ledgerControl` rung as the removal - a
   * restored account becomes postable again the moment a role names it.
   */
  chartAccountRestore: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await restoreChartAccount(ctx.db, {
        organizationId,
        accountId: input.id,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Mint the chart accounts one payment rail needs (brief 26 §7).
   *
   * 🛑 **Its own door, and deliberately NOT part of creating the gateway.**
   * `createPaymentGateway`'s jsdoc states *"What it must NOT do: mint an
   * account per gateway"* and §7.4 keeps that true: the gateway writer names
   * EXISTING accounts. A caller that wants both in one click calls this and
   * then `paymentGateway.create` with the ids that come back.
   *
   * 🛑 **No role, and no way to ask for one.** `mintRailAccounts` offers no
   * role parameter - the rule that killed `clearing_affirm` on 2026-09-10,
   * since a role must not name a vendor. A minted account is reached by id,
   * through the gateway record that points at it.
   *
   * ⚠️ `mintFeeAccount` is the CALLER's answer, not a derivation from the
   * rail. §5's defaults (a `netted` rail books to the shared `6100` fallback, a
   * `billed` rail mints its own) are the wizard's checkbox default; a mutation
   * that decided it here would overrule whatever the person just unticked.
   *
   * `handle` is used for one thing: defaulting the two account names through
   * the suggestion catalogue when the client did not send them. Suggestions
   * only - nothing here routes (§7.2), and an unknown handle gets a titled name
   * rather than a refusal.
   *
   * `ledgerControl`, the rung `chartAccountCreate` and `setRoleAssignment` both
   * sit on: this decides where real money lands.
   */
  mintRailAccounts: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        /** The gateway handle being routed, e.g. `'shopify_payments'`. Names only. */
        handle: z.string().min(1),
        /** Overrides the suggested clearing account name. */
        clearingAccountName: z.string().min(1).optional(),
        /** Mint a dedicated fee account as well as the clearing account. */
        mintFeeAccount: z.boolean(),
        /** Overrides the suggested fee account name. */
        feeAccountName: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const suggestion = suggestRail(input.handle)
      const result = await mintRailAccounts(ctx.db, {
        organizationId,
        actorUserId: userId,
        clearingAccountName: input.clearingAccountName ?? suggestion.clearingAccountName,
        mintFeeAccount: input.mintFeeAccount,
        feeAccountName: input.feeAccountName ?? suggestion.feeAccountName,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The export queue: one row per {@link ExportBatch}, expandable to the
   * postings it rolls up (TARGET §3, §6).
   *
   * A read, and `ledgerView`: asking changes nothing.
   */
  exportBatches: createTRPCRouter({
    list: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            /** One accounting month, `'2026-09'`. Bounds the read by DETAIL date. */
            month: z.string().min(1).optional(),
            state: z.enum(EXPORT_BATCH_STATES).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const result = await listExportBatches(ctx.db, {
          organizationId: ctx.session.organizationId,
          ...(input?.month ? { month: input.month } : {}),
          ...(input?.state ? { state: input.state } : {}),
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Build every batch a month still owes.
     *
     * 🛑 `ledgerPost`: building freezes a payload out of posted entries and is
     * the act that decides what leaves. It sends nothing - `autoSend` and the
     * sweep, or an explicit release, do that.
     */
    build: permissionProcedure(PermissionKey.ledgerPost)
      .input(monthKey)
      .mutation(async ({ ctx, input }) => {
        const result = await buildExportBatches(ctx.db, {
          organizationId: ctx.session.organizationId,
          from: `${input.periodKey}-01`,
          to: `${input.periodKey}-31`,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Send one batch and WAIT on the provider.
     *
     * The one-row door: a single row pressed on its own wants the refusal back
     * in the same breath. Use `release` for a bulk bar.
     */
    send: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ batchId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await sendExportBatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchId: input.batchId,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** Send a failed batch again, now, and reset the sweep's attempt budget. */
    retry: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ batchId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await retryExportBatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchId: input.batchId,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Hand held batches to the export worker, once.
     *
     * 🛑 It RELEASES and returns; it does not wait on the provider. A send is
     * three to five sequential round trips to a rate-limited third party and a
     * bulk bar acts on forty rows at once.
     *
     * ⚠️ 500 is a ceiling on ONE call, not on the queue.
     */
    release: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ batchIds: z.array(z.string().min(1)).min(1).max(500) }))
      .mutation(async ({ ctx, input }) => {
        const result = await releaseExportBatches(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchIds: input.batchIds,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Remove the provider's copy of a sent batch and free its postings for the
     * next build (TARGET §3, "Late changes follow Synder").
     *
     * 🛑 `ledgerControl`, not `ledgerPost`. Deleting rows out of the firm's
     * books is the authority that closes and reopens a period, not the one that
     * posts a journal.
     *
     * 🛑 An EXPORT operation, never a ledger one. Nothing here reverses, reopens
     * a period or releases a claim - the postings stay `posted` and come back to
     * *Ready*. Backing an entry out of OUR books is `reverse`.
     *
     * ⚠️ Unlike `release` this WAITS on the provider, and it is one batch per
     * call: the refusals are exactly what the operator pressed the button to
     * find out.
     */
    rollback: permissionProcedure(PermissionKey.ledgerControl)
      .input(z.object({ batchId: z.string().min(1), force: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const result = await rollbackExportBatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchId: input.batchId,
          ...(input.force === undefined ? {} : { force: input.force }),
        })
        if (result.isErr()) throw result.error
        return result.value
      }),
  }),

  /**
   * Prove that debits equal credits across every posted entry.
   *
   * The schema does not enforce the identity and this repo has no trigger
   * precedent, so the guarantee is three-part: `buildEntry` refuses to build an
   * unbalanced entry, the poster re-asserts in-transaction before commit, and
   * this sweep proves it after the fact. This is the third part.
   *
   * `postingsChecked` rides along on purpose - "0 discrepancies out of 0" and
   * "0 out of 412" are very different answers and the banner has to be able to
   * tell them apart.
   */
  // `periodKey` is OPTIONAL and adds the COMPLETENESS half - what that month
  // still owes the ledger (49 §2.4). Optional because the two callers genuinely
  // differ: the close console asks about the month on screen, while
  // `useAccountingSettingsFreeze` wants only `postingsChecked` and has no month.
  // Asked for nothing, the counts come back `null`, never `0`: a zero would read
  // as "nothing outstanding" for a question that was never put.
  verifyBalance: permissionProcedure(PermissionKey.ledgerView)
    .input(optionalMonthKey.optional())
    .query(async ({ ctx, input }) => {
      const result = await verifyBooksBalance(ctx.db, ctx.session.organizationId, {
        month: input?.periodKey,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Do our books and theirs agree as of one date, and if not, where
   * (plans/accounting/tasks/20-two-authors-one-ledger.md §8).
   *
   * Reads the provider's balance sheet and OUR trial balance as of the same
   * date, joins them through the `qboAccountId` links `chart-import.ts` stamps,
   * and hands both sides to the pure `planProviderAgreement`. Writes nothing,
   * posts nothing, and never becomes a statement source - §0.7 holds, this is a
   * COMPARISON beside the statements and the sync is what will make the
   * statements complete.
   *
   * ⚠️ **This one reaches the provider**, the same caveat {@link accountMap}
   * carries: it fetches a balance sheet over the app Lambda, so it is slow
   * relative to its neighbours. Cadence is at close and on demand, never
   * continuous (§8.3) - do not put it behind a component that runs on mount.
   *
   * 🛑 Three outcomes a screen has to be able to tell apart, and only one of
   * them is an error:
   *
   *   1. `not_connected` - nothing is authorized. A complete answer to a read
   *      (`P1`), not a failure and not an empty agreement.
   *   2. `ok` with `agreement.providerHasData: false` - connected, and the
   *      provider answered with an empty company. Distinct from agreement.
   *   3. `ok` with `agreement.totalDifferenceMinor === 0` - the books agree.
   *
   * The only refusal is a provider id claimed by more than one of our accounts,
   * which `planProviderAgreement` returns as an `err` naming BOTH accounts
   * (§8.2). It is thrown straight through - there is deliberately no `try/catch`
   * here, because catching and rethrowing is the only way an `AuxxError` gets
   * flattened into a generic 500 on its way to `auxxErrorMiddleware`.
   */
  providerAgreement: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        /** `YYYY-MM-DD`. Both sides are read as of this same day. */
        asOf: z.iso.date({ error: 'asOf must be YYYY-MM-DD' }),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const provider = await resolveAccountingProvider(organizationId)

      // Asked FIRST, and on its own: an org with nothing connected has nothing
      // to compare against, so there is no reason to read our own trial balance
      // or the account map for it.
      const sheetResult = await provider.readProviderBalances(organizationId, input.asOf)
      if (sheetResult.isErr()) throw sheetResult.error
      const sheet = sheetResult.value
      if (!sheet) return { status: 'not_connected' as const, asOf: input.asOf }

      const [ours, mappings] = await Promise.all([
        // Cumulative from the beginning of time - `from` is deliberately
        // omitted. A balance as of a date is what the provider's balance sheet
        // reports, and an activity-only window would compare a period's
        // movement against a running balance.
        readTrialBalance(ctx.db, { organizationId, to: input.asOf }),
        provider.listAccountMappings(organizationId),
      ])
      if (ours.isErr()) throw ours.error
      if (mappings.isErr()) throw mappings.error

      const planned = planProviderAgreement({
        provider: sheet.rows,
        ours: ours.value.rows,
        accountMap: mappings.value,
        // The provider's own `Header.EndPeriod`, already asserted equal to the
        // `asOf` that was asked for. Echoing the request instead would let a
        // report the provider silently re-dated render under the wrong day.
        asOf: sheet.asOf,
        providerHasData: sheet.hasData,
      })
      if (planned.isErr()) throw planned.error

      return {
        status: 'ok' as const,
        providerId: provider.id,
        /** Their reporting currency. Compared against ours by the screen, never converted. */
        providerCurrency: sheet.currency,
        agreement: planned.value,
      }
    }),

  /**
   * Open a walk over the connected provider's general ledger, so everything the
   * accountant authored there reaches these books
   * (plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §2, §4.6).
   *
   * 🛑 **It ENQUEUES; it does not walk.** Nine months is nine sequential
   * app-runtime round trips and the transport gives up before the walk does
   * (§2), so the body is one bounded `add()` and the answer is a run handle
   * rather than a `ProviderSyncOutcome`. What the run found is read back through
   * {@link providerSyncRunState}, which survives a remount, a refresh and a
   * dropped connection - the three things that lost the outcome before.
   *
   * 🛑 **`ledgerControl`, not `ledgerPost` and not `ledgerView`.** This is not
   * "post an entry": the sync walks from the cutover forward and RESTATES PRIOR
   * MONTHS - it writes entries dated into months that are already closed (which
   * it defers, §7.2) and REVERSES entries whose provider id has stopped
   * appearing (§7.1). That is the same class of authority `setLockedThrough`
   * takes, and a bookkeeper holding `ledgerPost` posts what is in front of them
   * rather than deciding that last December is now different.
   *
   * `from` is optional and means "everything the sync is allowed to see",
   * starting the month after `accounting.cutoffPeriod`. 🛑 A `from` BELOW that
   * floor is a refusal from `planSyncChunks`, never a clamp - reading the
   * opening period back would import the balances brief 19's opening entry was
   * derived from and double the entire opening position. The floor is asserted
   * in the worker, where the source is built.
   *
   * 🛑 No `try/catch`. `enqueueProviderSync` throws `ConflictError` when a walk
   * is already open for this org, and catching it is the only way an `AuxxError`
   * gets flattened into a generic 500 on its way to `auxxErrorMiddleware`.
   */
  syncProviderLedger: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        /** `YYYY-MM-DD`. Omitted means the cutover floor - see above. */
        from: z.iso.date({ error: 'from must be YYYY-MM-DD' }).optional(),
        /** `YYYY-MM-DD`, inclusive. Usually today in the book timezone. */
        to: z.iso.date({ error: 'to must be YYYY-MM-DD' }),
      })
    )
    .use(notDemo('sync the accounting provider ledger'))
    .mutation(async ({ ctx, input }) => {
      const queued = await enqueueProviderSync({
        organizationId: ctx.session.organizationId,
        from: input.from,
        to: input.to,
        trigger: 'pressed',
        actorUserId: ctx.session.userId,
      })
      // 🛑 A dropped enqueue is a press that did nothing at all - there is no
      // sweep until §5's cadence exists - so it is surfaced rather than logged
      // (§4.6.2). 422 rather than the truer 500: `errorFormatter` replaces every
      // `INTERNAL_SERVER_ERROR` message with "Internal server error", and the
      // one thing this refusal has to carry is that nothing was started.
      if (!queued) {
        throw new UnprocessableEntityError(
          'The sync could not be queued, so nothing was started and nothing was read. The job ' +
            'queue did not accept the request. Try again in a moment.',
          { organizationId: ctx.session.organizationId }
        )
      }
      return { status: 'queued' as const, from: input.from ?? null, to: input.to }
    }),

  /**
   * The inbound sync's own run state - what the panel renders (§4.4, §4.8).
   *
   * 🛑 Read from the `OrganizationSetting` ROW, never through `useSettings` or
   * `getOrganizationSetting`. Both resolve from the `orgSettings` org cache, and
   * `providerSync.state` is written after every slice with cache invalidation
   * deliberately skipped - so a cached read renders a blob several chunks stale.
   * `readProviderSyncRunState` selects the row.
   *
   * `stale` is §7.4's display fix rather than a recovery one: a chain killed
   * mid-slice by a worker restart leaves `currentRun` open with nothing to close
   * it, and a panel that believed the blob would show it running for ever. The
   * heartbeat is compared here so the browser needs no copy of the threshold -
   * `queue.ts` is server-only and the constant would not survive the client
   * boundary.
   */
  providerSyncRunState: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await readProviderSyncRunState(ctx.session.organizationId)
    if (result.isErr()) throw result.error
    const { currentRun, lastRun } = result.value
    const silentMs = currentRun ? Date.now() - Date.parse(currentRun.heartbeatAt) : 0
    return {
      currentRun: currentRun ?? null,
      lastRun: lastRun ?? null,
      /** The open run has gone quiet past the takeover threshold; a press may restart it. */
      stale: Boolean(currentRun) && !(silentMs < PROVIDER_SYNC_RUN_STALE_MS),
    }
  }),

  /**
   * How often the inbound sync runs by itself (brief 55 §5.1).
   *
   * 🛑 NOT `setting.updateOrganizationSetting`, which is why the key is
   * router-owned there. Writing `providerSync.schedule` and registering the
   * BullMQ job scheduler are one act: a value written without
   * `syncProviderSyncScheduler` is a cadence the screen claims and nothing
   * fires, and a scheduler left registered after the value says `off` is the
   * reverse. One door keeps them from disagreeing.
   *
   * 🛑 `ledgerControl`. A cadence decides when prior months get restated without
   * anybody watching, which is the same authority the press itself takes.
   *
   * ⚠️ The CADENCE is an enum here rather than a free `ScheduledTriggerConfig`.
   * The shape allows a five-minute poll; an accounting ledger read every five
   * minutes is a rate-limit incident with nobody's name on it. Three choices is
   * the whole vocabulary this door offers, and the config is built from them.
   */
  setProviderSyncSchedule: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ cadence: z.enum(['off', 'twice-daily', 'daily']) }))
    .use(notDemo('schedule the accounting provider sync'))
    .mutation(async ({ ctx, input }) => {
      const zone = await getOrganizationSetting({
        organizationId: ctx.session.organizationId,
        key: 'accounting.bookTimeZone',
      })
      // The books' own zone, not the browser's: a daily fire is a fire on an
      // accounting day, and the reader may be sitting in another one.
      const timezone = typeof zone === 'string' && zone.trim() ? zone.trim() : 'UTC'
      const config: ProviderSyncScheduleConfig =
        input.cadence === 'off'
          ? { triggerInterval: 'off', timeBetweenTriggers: {}, timezone }
          : {
              triggerInterval: 'hours',
              timeBetweenTriggers: {
                hours: input.cadence === 'twice-daily' ? 12 : 24,
                isConstant: true,
              },
              timezone,
            }

      await updateOrganizationSetting({
        organizationId: ctx.session.organizationId,
        key: PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
        value: config,
        db: ctx.db,
      })
      await syncProviderSyncScheduler(ctx.session.organizationId)
      return { cadence: input.cadence }
    }),

  /**
   * Every posting in one month EXCEPT the close entry - the ledger page's
   * entries list.
   *
   * `periods` above answers "which months have a close entry", which is a
   * different question and cannot be made to answer this one. Under L1 a month
   * held exactly one posting and no list was needed; a manual journal entry is
   * what makes a month hold N.
   *
   * The month-end inventory entry is excluded because the console renders it
   * INLINE above this list, with its own roll-forward, its own blockers and its
   * own Post button. Including it here would give the screen two places to post
   * the same thing.
   */
  listPostings: permissionProcedure(PermissionKey.ledgerView)
    // 🛑 The month is OPTIONAL here and required by `monthKey` elsewhere. The
    // ledger page resolves no month for a finalized org whose cutoff is in the
    // future, and its Entries section is the only door to a manual entry, so
    // demanding one made every posting invisible on the screen a bookkeeper
    // opens to find them. A MALFORMED month is still refused by the regex.
    .input(optionalMonthKey)
    .query(async ({ ctx, input }) => {
      const result = await listPostings(ctx.db, {
        organizationId: ctx.session.organizationId,
        periodKey: input.periodKey,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Every posting one record produced - the `ledger` card on an order, an
   * invoice, a payment or a journal entry.
   *
   * Reached through `GlPostingSource` (TARGET §1), never a stamp field and
   * never `GlPostingLine.sourceType`: one query, every link role. `sourceKind`
   * is a free string rather than an enum on purpose - it names the KIND of
   * record a posting is linked to and new kinds arrive with new builders, so an
   * enum here would have to be edited in lockstep with a vocabulary this router
   * does not own. There is nothing to leak - both halves are scoped to the
   * caller's organization in SQL.
   */
  listPostingsForSource: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ sourceKind: z.string().min(1), sourceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await listPostingsForSource(ctx.db, {
        organizationId: ctx.session.organizationId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The summarised view over the detail ledger (TARGET §6) - posted postings
   * grouped by avenue, grain bucket, store, rail and currency, lines summed by
   * account, drilling down through `postingIds`. The same read serves
   * Transaction and Summary mode (TARGET §3): the grain per avenue comes from
   * `accounting.summaryGrain.*`.
   *
   * 🛑 Nothing is excluded for a live export batch here - `ExportBatchPosting`
   * doesn't exist yet (step 3, part B). Once it does, this passes the ids it
   * finds as `excludePostingIds` so a batched posting is not offered twice.
   */
  summary: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        from: z.iso.date({ error: 'from must be YYYY-MM-DD' }),
        to: z.iso.date({ error: 'to must be YYYY-MM-DD' }),
        avenue: z.enum(EXPORT_AVENUES).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const settings = await readExportSettings(ctx.db, organizationId)

      const result = await readLedgerSummary(ctx.db, {
        organizationId,
        from: input.from,
        to: input.to,
        avenue: input.avenue,
        grainByAvenue: settings.summaryGrain,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Every DRAFT posting in one accounting month - the Drafts tab (TARGET §4
   * gate 1, step 1c). A draft holds no claim and no doc number; `autoPost` off
   * on its avenue is what leaves one here instead of `posted`.
   *
   * Filtered in this router rather than in `listPostings` itself: the lib read
   * answers "what is in this month", and status is one more thing a caller
   * narrows on, the same way the close console excludes `month_end_inventory`
   * by name rather than the read growing a parameter per screen.
   *
   * `ledgerPost`, not `ledgerView`: the Drafts tab is where a draft gets
   * approved or discarded, and reviewing what is queued to post is part of
   * that authority, not a separate read anyone with `ledgerView` should get.
   */
  listDrafts: permissionProcedure(PermissionKey.ledgerPost)
    .input(monthKey)
    .query(async ({ ctx, input }) => {
      const result = await listPostings(ctx.db, {
        organizationId: ctx.session.organizationId,
        periodKey: input.periodKey,
      })
      if (result.isErr()) throw result.error
      return result.value.filter((posting) => posting.status === 'draft')
    }),

  /**
   * Promote a draft: re-resolve its roles, re-check the period lock, claim,
   * number, flip to `posted` (TARGET §4 gate 1). Never throws - a closed period
   * or an account the chart no longer holds comes back as a `PostResult` status
   * the Drafts tab renders, exactly as {@link post} does.
   */
  postDraft: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ glPostingId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const lock = await resolvePeriodLock(organizationId)

      return postDraft(ctx.db, {
        organizationId,
        glPostingId: input.glPostingId,
        actorUserId: userId,
        lock,
      })
    }),

  /**
   * Throw a draft posting away: its lines, then the header. A draft holds no
   * claim, so nothing is released - there is simply nothing left to post.
   */
  discardDraft: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ glPostingId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await discardDraftPosting(ctx.db, {
        organizationId: ctx.session.organizationId,
        glPostingId: input.glPostingId,
      })
      if (result.isErr()) throw result.error
      return { glPostingId: input.glPostingId, discarded: true }
    }),

  /**
   * The newest posting of every type the organization has ever posted, one
   * row per type (brief 28 §3.2). The Posting settings page prints each
   * section's "Last posted" line from this; a type with no row has never
   * posted. One grouped read rather than a `listPostings` per section.
   */
  latestPostingsByType: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await readLatestPostingsByType(ctx.db, {
      organizationId: ctx.session.organizationId,
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * The journal-entry DRAFT - the record a bookkeeper types a posting into, and
   * the holder of the opening trial balance (HANDOFF decision 6.7).
   *
   * ## Why the draft is a record and not a client-side buffer
   *
   * The entry's NUMBER is issued on create and becomes the posting's
   * `periodKey` (`doc-number.ts`), so an entry cannot be posted until it has
   * one - which means the draft has to exist server-side before Post is
   * reachable at all. That is also what lets the opening trial balance be a
   * draft the wizard fills in over several sittings, and what gives the
   * attachment somewhere to hang.
   *
   * ## The gates
   *
   * | procedure | gate |
   * | --- | --- |
   * | `get`, `list`, `preview` | `ledger.view` |
   * | `create`, `update`, `post`, `reverse` | `ledger.post` |
   *
   * 🛑 `create` and `update` are `ledgerPost`, not `ledgerView`, even though
   * neither writes a posting. A draft is the thing somebody then presses Post
   * on, and `setRoleAssignment` above made the same call for the same reason:
   * this decides where real money lands. `journal_entry` stays
   * `isVisible: false` so this is its only door - routing it through
   * `record.create` would hand it to anyone with records-Full and ledger-None.
   */
  journalEntry: createTRPCRouter({
    /**
     * Raise a draft. Lines may be empty - a person opens the drawer before they
     * have typed anything, and refusing an empty draft would mean the drawer
     * could not save until it balanced.
     */
    create: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          // 🛑 No `recurring` here, deliberately. A generated entry is raised
          // by the daily sweep and by nothing else: it has to carry the rule
          // and the slot its posting is keyed on, and a person typing one by
          // hand would either omit them (refused) or claim a slot the sweep
          // would then raise a second entry for.
          kind: z.enum(['manual', 'opening_balance', 'recurring_template']).optional(),
          date: z.iso.date({ error: 'date must be YYYY-MM-DD' }),
          memo: z.string().max(4000).optional(),
          lines: z.array(journalEntryLine).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await createJournalEntry(ctx.db, organizationId, userId, input)
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Edit a draft. `lines` is replaced WHOLESALE when present - a draft's lines
     * have no identity, and a patch protocol over them would need row ids the
     * JSON does not carry.
     *
     * Refused on a posted entry with a `ConflictError`: the ledger has no update
     * path, so an edit could only ever mean this record's JSON disagreeing with
     * the numbers actually posted.
     */
    update: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          id: z.string().min(1),
          date: z.iso.date({ error: 'date must be YYYY-MM-DD' }).optional(),
          /** An empty string CLEARS the memo; omitting the key leaves it alone. */
          memo: z.string().max(4000).optional(),
          lines: z.array(journalEntryLine).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const { id, ...values } = input
        const result = await updateJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: id,
          ...values,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** One draft, or a `NotFoundError` for an id that is not this org's. */
    get: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const result = await getJournalEntry(ctx.db, ctx.session.organizationId, input.id)
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Drafts and posted entries, newest first.
     *
     * ⚠️ `periodKey` filters on the entry's own accounting DATE, month by
     * month - not on the posting's `periodKey`, which for a `manual_journal` is
     * the entry number.
     */
    list: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            // A LIST, because the drafts list wants the two kinds a person
            // reviews and posts - hand-authored and sweep-generated - and not
            // the stencil, which one value cannot express.
            kinds: z
              .array(z.enum(['manual', 'opening_balance', 'recurring_template', 'recurring']))
              .min(1)
              .max(4)
              .optional(),
            status: z.enum(['draft', 'posted', 'reversed']).optional(),
            periodKey: z
              .string()
              .regex(/^\d{4}-\d{2}$/, 'periodKey must be a YYYY-MM month')
              .optional(),
            limit: z.number().int().positive().max(200).optional(),
            offset: z.number().int().nonnegative().optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const result = await listJournalEntries(ctx.db, ctx.session.organizationId, input ?? {})
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * What this draft WOULD post. Persists nothing, including the overrides.
     *
     * The overrides exist so the drawer can preview what is on screen without
     * saving first - the totals strip and the blockers card both want an answer
     * for the entry as it is being typed, and forcing a save to get one would
     * write a draft on every keystroke.
     *
     * A `.mutation()` despite writing nothing, for `preview`'s two reasons: the
     * lines are a request BODY and do not fit in a URL, and a preview keyed on
     * the entire draft is not cacheable in any useful sense.
     */
    preview: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z.object({
          id: z.string().min(1),
          date: z.iso.date({ error: 'date must be YYYY-MM-DD' }).optional(),
          memo: z.string().max(4000).optional(),
          lines: z.array(journalEntryLine).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...overrides } = input
        const result = await previewJournalEntry(ctx.db, ctx.session.organizationId, {
          journalEntryId: id,
          ...overrides,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Post the draft and stamp the record.
     *
     * Returns a `PostResult` verbatim, for the reason `post` above does: a
     * closed period, an account that is not in the chart and an inventory
     * account named by code all arrive as a status the screen RENDERS.
     */
    post: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1), memo: z.string().max(4000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await postJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: input.id,
          memo: input.memo,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Throw a DRAFT away. Archives the record; the row and its number stay.
     *
     * 🛑 `ledgerPost`, not `ledgerView`. Discarding is a write, and the key that
     * gates creating and editing a draft is the key that gates throwing one
     * away - handing it to a read-only ledger member would let them clear the
     * Entries list of somebody else's half-finished adjusting entries.
     *
     * The lib error is rethrown UNWRAPPED so `auxxErrorMiddleware` maps its
     * `ConflictError` to a 409, exactly as `post` and `reverse` do: a posted
     * entry refuses here and the message points at reversal, and flattening it
     * into a 500 would throw that sentence away.
     */
    discard: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await discardJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: input.id,
        })
        if (result.isErr()) throw result.error
        return { id: input.id, discarded: true }
      }),

    /**
     * Back the posted entry out with a second, opposite one, and flip the
     * record to `reversed`.
     *
     * There is no edit and no void. Gated on `ledgerPost` rather than a key of
     * its own: a reversal IS a post, it lands in the same books, and someone
     * trusted to write to the ledger is exactly who should be able to correct
     * it.
     */
    reverse: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1), memo: z.string().max(4000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await reverseJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: input.id,
          memo: input.memo,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),
  }),

  /**
   * The SCHEDULE on a recurring journal template
   * (`plans/accounting/tasks/21-the-books-stand-alone.md` §1).
   *
   * The template itself is an ordinary `journalEntry` record with
   * `kind: 'recurring_template'` - it is created, edited and discarded through
   * the procedures above, because it holds exactly the same lines, memo and
   * date every other draft does. What is new is the rule that says how often
   * it repeats, and that is all this sub-router owns.
   *
   * ## The gates
   *
   * | procedure | gate |
   * | --- | --- |
   * | `list` | `ledger.view` |
   * | `setSchedule`, `clearSchedule` | `ledger.control` |
   *
   * 🛑 `ledgerControl` on the writes, not `ledgerPost`. A schedule decides what
   * lands in the books every month without anybody pressing anything, which is
   * the same authority `setLockedThrough` takes. A bookkeeper with
   * `ledgerPost` still reviews and posts each generated draft; what they may
   * not do is change what generates.
   */
  recurringTemplate: createTRPCRouter({
    /**
     * Every template, its schedule, and what the next sweep owes.
     *
     * The plan comes from the same pure planner the sweep runs, so the screen
     * cannot disagree with the job about which month is being held.
     */
    list: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
      const result = await listRecurringJournalTemplates(ctx.db, ctx.session.organizationId)
      if (result.isErr()) throw result.error
      return result.value
    }),

    /**
     * Attach or replace a template's schedule.
     *
     * No `timezone` input: the rule stores the org's `accounting.bookTimeZone`
     * and nothing reads a zone from anywhere else. A browser-detected zone
     * would make two authorities out of the month boundary, and a December 31
     * entry would land in January for a template saved one zone east.
     */
    setSchedule: permissionProcedure(PermissionKey.ledgerControl)
      .use(notDemo('change a recurring journal schedule'))
      .input(
        z.object({
          templateId: z.string().min(1),
          pattern: recurrencePatternSchema,
          anchor: z.iso.date({ error: 'anchor must be YYYY-MM-DD' }).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await setRecurringJournalSchedule(ctx.db, ctx.session.organizationId, input)
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Stop a template repeating. Entries it has already generated are
     * untouched - a schedule is configuration and the entries are what
     * happened.
     */
    clearSchedule: permissionProcedure(PermissionKey.ledgerControl)
      .use(notDemo('remove a recurring journal schedule'))
      .input(z.object({ templateId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await clearRecurringJournalSchedule(
          ctx.db,
          ctx.session.organizationId,
          input.templateId
        )
        if (result.isErr()) throw result.error
        return { ok: true }
      }),
  }),
})
