// apps/web/src/server/api/routers/ledger.ts

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { UnprocessableEntityError } from '@auxx/lib/errors'
import { PermissionKey } from '@auxx/lib/permissions'
import {
  ACCOUNT_ROLES,
  buildEntry,
  confirmSuggestedIdentities,
  createChartAccount,
  GL_ACCOUNT_TYPES,
  getPosting,
  listAccountIdentities,
  listChartAccounts,
  listChartAccountUsage,
  listClosePeriods,
  listRoleMap,
  listUnpostedPeriods,
  POSTING_TYPES,
  postEntry,
  postMonthEnd,
  previewEntry,
  previewMonthEnd,
  removeChartAccount,
  resolvePeriodLock,
  reverseEntry,
  setAccountIdentity,
  setRoleAssignment,
  updateChartAccount,
  verifyBooksBalance,
} from '@auxx/lib/postings'
import { seedDefaultChartOfAccounts } from '@auxx/lib/seed'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/**
 * One draft line, structurally.
 *
 * Deliberately thin on the money rules. `amount` is a plain number here rather
 * than `z.number().int().positive()` because `buildEntry` already refuses a
 * non-integer, a negative and a zero, and it names the offending role while
 * doing it. Restating those three rules in Zod would give the same input two
 * authorities and two error vocabularies, and the worse one would win: a Zod
 * issue reads `lines.3.amount: Number must be greater than 0`, where
 * `buildEntry` says which role the leg belongs to. A bookkeeper reads the
 * second one at 11pm on the 3rd.
 */
const postingLine = z.object({
  /** An auxx ROLE (`'grni'`), never an account number. See `postings/types.ts`. */
  accountRole: z.string().min(1),
  direction: z.enum(['debit', 'credit']),
  /** Integer minor units, positive. `direction` carries the sign. */
  amount: z.number(),
  memo: z.string().optional(),
  /** The kind of row that produced this line - `'stock_movement'`, `'vendor_bill'`. */
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
})

/**
 * A draft entry, as a caller hands it in.
 *
 * ⚠️ **The totals are NOT part of this shape**, and that is the point. A
 * `BuiltEntry` carries `totalDebit`/`totalCredit` and is balanced by
 * construction, so accepting one over the wire would mean trusting a client's
 * arithmetic about a general ledger. What crosses the wire is the DRAFT; the
 * server runs `buildEntry` over it and that is where the totals come from and
 * where an unbalanced entry is refused.
 */
const draftEntry = z.object({
  postingType: z.enum(POSTING_TYPES),
  /** `'2026-08'` for a month, `'2026-08-18'` for a day. `parsePeriodKey` owns the keyspace. */
  periodKey: z.string().min(1),
  /**
   * `YYYY-MM-DD`. Validated here because nothing downstream does: `buildEntry`
   * passes it through untouched and a provider handed a malformed date falls
   * back to its own server date, which silently books the entry on the wrong day.
   */
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'txnDate must be YYYY-MM-DD'),
  /**
   * Bounded rather than merely non-empty. The cap is far above any entry this
   * poster produces - a month-end inventory entry is one line per account role -
   * and exists only so a malformed client cannot send an unbounded array.
   */
  lines: z.array(postingLine).min(1).max(200),
})

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
 * | `preview`         | `ledger.view` |
 * | `unpostedPeriods` | `ledger.view` |
 * | `verifyBalance`   | `ledger.view` |
 * | `post`            | `ledger.post` |
 * | `reverse`         | `ledger.post` |
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
 * `previewMonthEnd` / `postMonthEnd`, which answer with a status and a message
 * naming the exact row to fix. Restating any of that in Zod would give the same
 * input two authorities and the worse error would win.
 */
const monthKey = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, 'periodKey must be a YYYY-MM month'),
})

export const ledgerRouter = createTRPCRouter({
  /**
   * What an entry WOULD look like, resolved against the org's own chart.
   *
   * **Persists nothing.** It runs the same reads and the same refusals as
   * {@link postEntry} - including the ones that would block it, which arrive on
   * `blockedBy` - and writes not one row. Claiming the period is `post`'s job
   * and only `post`'s.
   *
   * A `.mutation()` even though it writes nothing, for two reasons that both
   * point the same way. The draft is a request BODY: queries are GETs on this
   * app's link and a 200-line entry does not fit in a URL. And a preview keyed
   * on the entire draft is not cacheable in any useful sense - the input already
   * IS the answer's content - so mutation semantics (fire on click, no refetch)
   * are what the Preview button actually wants.
   */
  preview: permissionProcedure(PermissionKey.ledgerView)
    .input(draftEntry)
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const entry = buildEntry(input)
      const lock = await resolvePeriodLock(organizationId)

      return previewEntry(ctx.db, { organizationId, entry, lock })
    }),

  /**
   * Claim the period, persist the entry, and push it to whichever provider the
   * organization has connected - in one call.
   *
   * An org with NO provider connected is a first-class case, not a degraded one
   * (decision P1): the entry is built, balanced and persisted exactly the same
   * way and the result is `not_connected`. Likewise `already_posted` is a
   * SUCCESS - a converged re-run, not a failure - and callers must not surface
   * it as an error.
   */
  post: permissionProcedure(PermissionKey.ledgerPost)
    .input(draftEntry.extend({ memo: z.string().max(4000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { memo, ...draft } = input

      const entry = buildEntry(draft)
      const lock = await resolvePeriodLock(organizationId)

      return postEntry(ctx.db, {
        organizationId,
        entry,
        actorUserId: userId,
        memo,
        lock,
      })
    }),

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
    const result = await listClosePeriods(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * What the month-end inventory entry for one PERIOD would look like.
   *
   * The difference from {@link preview} is the input: that one takes a
   * client-supplied line array and is effectively a manual-journal-entry
   * surface, while this one takes a month and builds the entry from the
   * subledger. The close console uses this one; nothing should be asking an
   * operator to hand-write the lines of a month-end close.
   *
   * **Persists nothing.** Every refusal arrives on `blockedBy` rather than as a
   * throw - including `nothing_to_close` (no activity this month) and
   * `setup_incomplete` (no reconciled opening baseline yet), which are ordinary
   * outcomes and not failures. The message is the gathered one verbatim: it
   * names the exact uncosted movement, unpriced row or blank setting to fix, and
   * losing that text is the single most expensive thing this procedure could do.
   */
  previewMonthEnd: permissionProcedure(PermissionKey.ledgerView)
    .input(monthKey)
    .mutation(async ({ ctx, input }) => {
      return previewMonthEnd(ctx.db, {
        organizationId: ctx.session.organizationId,
        periodKey: input.periodKey,
      })
    }),

  /**
   * Close one month: gather, build, claim the period, persist, export.
   *
   * Returns a `PostResult` and never throws for a business refusal, exactly as
   * {@link post} does. `nothing_to_close` and `setup_incomplete` are NOT errors
   * and must not be surfaced as such - see `postings/types.ts`.
   */
  postMonthEnd: permissionProcedure(PermissionKey.ledgerPost)
    .input(monthKey.extend({ memo: z.string().max(4000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      return postMonthEnd(ctx.db, {
        organizationId,
        periodKey: input.periodKey,
        actorUserId: userId,
        memo: input.memo,
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
   * Every posting role and the account it resolves to.
   *
   * Returns a row for EVERY role in `ACCOUNT_ROLES`, mapped or not: the role map
   * is a complete checklist, and a list of only the rows that happen to exist
   * could never show what is missing.
   */
  roleMap: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listRoleMap(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Point one role at an account, or mark it unused.
   *
   * Gated on `ledgerPost` rather than `ledgerView`: this decides which account
   * real money lands in, so it belongs with the people trusted to write to the
   * books, not with everyone who can read them.
   */
  setRoleAssignment: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        role: z.enum(Object.values(ACCOUNT_ROLES) as [string, ...string[]]),
        glAccountId: z.string().min(1).nullish(),
        markedUnused: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await setRoleAssignment(ctx.db, {
        organizationId,
        role: input.role,
        glAccountId: input.glAccountId,
        markedUnused: input.markedUnused,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The organization's chart of accounts - every non-archived `gl_account`. */
  chartAccounts: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listChartAccounts(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * How many posted lines carry each account CODE.
   *
   * Read by the Chart of accounts tab alone, to turn the renumber caution into a
   * number: a posting line names an account by code with no foreign key (`P2`),
   * so renumbering leaves every line already posted holding the old one.
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
   * Gated on `ledgerPost` for `setRoleAssignment`'s reason: this decides which
   * external account real money lands in, so it belongs with the people trusted
   * to write to the books rather than everyone who can read them.
   */
  setAccountIdentity: permissionProcedure(PermissionKey.ledgerPost)
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
  confirmSuggestedAccounts: permissionProcedure(PermissionKey.ledgerPost).mutation(
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
   * Write the 29-account default chart, and point each role at the account that
   * fulfils it.
   *
   * ── Why this is a BUTTON and not part of creating an organization ──
   *
   * `gl_account`'s DEFINITION ships with every org (`SYSTEM_ENTITIES`), but its
   * ROWS do not, deliberately: most orgs never open the accounting module, and 29
   * `EntityInstance`s plus 13 `GlRoleAssignment`s each is a chart nobody asked for
   * in a table everybody has to scan. Provisioning is the first step of setting
   * accounting up, so it lives where somebody has said they want accounting.
   *
   * 🛑 It also closes a real hole. `seedDefaultChartOfAccounts`' only other caller
   * is entity migration 108, which reaches production through the DataMigration
   * ledger - and `DataMigration.id` is the PRIMARY KEY, one global row, no
   * `organizationId`. Once 108 is `applied` it never runs again, so **every org
   * created after that deploy would have had a def, no accounts, thirteen
   * unmapped roles and no way to fix it.** This is that way.
   *
   * Safe to press twice: the seed is idempotent on `code` and its assignments are
   * `ON CONFLICT (organizationId, role) DO NOTHING`, so a second press reports
   * `created: 0` and cannot disturb an account or a mapping somebody has edited.
   * That is `seedDefaultChartOfAccounts`' rules 1, 3 and 4, and they are the whole
   * reason this can be offered as a button at all.
   */
  provisionChart: permissionProcedure(PermissionKey.ledgerPost).mutation(async ({ ctx }) => {
    const { organizationId } = ctx.session

    const glAccountDefId = await getCachedEntityDefId(organizationId, 'gl_account')
    if (!glAccountDefId) {
      throw new UnprocessableEntityError(
        'This organization has no gl_account definition, so there is nothing to seed a chart into. Run the entity migrations.',
        { organizationId }
      )
    }

    return await seedDefaultChartOfAccounts(ctx.db, organizationId, glAccountDefId)
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
   * resulting entry still balances. The ledger area has exactly two rungs, and
   * `setRoleAssignment` above already made this call for the same reason: this
   * decides where real money lands.
   *
   * `gl_account` therefore stays `isVisible: false` and this is its only door.
   *
   * The refusals are the lib's, verbatim - see `postings/chart-write.ts`. Zod
   * checks structure only, for the reason `postingLine` gives at the top of this
   * file: two authorities over one input, and the worse message wins.
   */
  chartAccountCreate: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        accountType: z.enum(GL_ACCOUNT_TYPES),
        isActive: z.boolean().optional(),
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
   * refused when a role still posts to the account, naming it.
   */
  chartAccountUpdate: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        id: z.string().min(1),
        code: z.string().optional(),
        name: z.string().optional(),
        accountType: z.enum(GL_ACCOUNT_TYPES).optional(),
        isActive: z.boolean().optional(),
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
  chartAccountRemove: permissionProcedure(PermissionKey.ledgerPost)
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
   * Every entry that has been claimed but is not in the books - the close
   * console's "you have 3 unposted periods" banner.
   *
   * `pending` and `failed` come back distinct rather than collapsed, because
   * they call for different actions: `pending` is claimed and in flight (or
   * claimed by a run that died mid-push, which the idempotency ladder heals),
   * while `failed` was attempted and refused and carries the reason.
   */
  unpostedPeriods: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ through: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const result = await listUnpostedPeriods(ctx.db, organizationId, {
        through: input?.through,
      })
      if (result.isErr()) throw result.error
      return result.value
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
  verifyBalance: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await verifyBooksBalance(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),
})
