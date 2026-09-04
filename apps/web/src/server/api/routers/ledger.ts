// apps/web/src/server/api/routers/ledger.ts

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { UnprocessableEntityError } from '@auxx/lib/errors'
import { PermissionKey } from '@auxx/lib/permissions'
import {
  ACCOUNT_ROLES,
  buildEntry,
  confirmSuggestedIdentities,
  createChartAccount,
  createJournalEntry,
  GL_ACCOUNT_TYPES,
  getJournalEntry,
  getPosting,
  listAccountIdentities,
  listChartAccounts,
  listChartAccountUsage,
  listClosePeriods,
  listJournalEntries,
  listPostings,
  listPostingsForSource,
  listRoleMap,
  listUnpostedPeriods,
  POSTING_TYPES,
  postEntry,
  postJournalEntry,
  postMonthEnd,
  previewEntry,
  previewJournalEntry,
  previewMonthEnd,
  removeChartAccount,
  resolvePeriodLock,
  reverseEntry,
  reverseJournalEntry,
  setAccountIdentity,
  setRoleAssignment,
  updateChartAccount,
  updateJournalEntry,
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
const postingLineBase = {
  direction: z.enum(['debit', 'credit']),
  /** Integer minor units, positive. `direction` carries the sign. */
  amount: z.number(),
  memo: z.string().optional(),
  /** The kind of row that produced this line - `'stock_movement'`, `'journal_entry'`. */
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
}

/**
 * A BUILDER's line: an auxx ROLE, never an account number.
 *
 * `.strict()`, and that is load-bearing - see {@link postingLine}.
 */
const roleLine = z
  .object({
    /** One of `ACCOUNT_ROLES`. See `postings/types.ts` for why a builder emits a role. */
    accountRole: z.string().min(1),
    ...postingLineBase,
  })
  .strict()

/** A HUMAN's line: a code out of this org's own chart. `.strict()`, see {@link postingLine}. */
const codeLine = z
  .object({
    /** `'6300'`. Validated against the chart with the same refusals a role gets. */
    accountCode: z.string().min(1),
    ...postingLineBase,
  })
  .strict()

/**
 * A union rather than two optional keys.
 *
 * `{ accountRole?: string; accountCode?: string }` would accept a line naming
 * both, and every reader downstream would need a precedence rule - which is a
 * rule about which of two named accounts money silently goes into.
 * `GlPostingLineInput` is a discriminated union for the same reason, and this is
 * that shape at the wire.
 *
 * 🛑 **Both branches are `.strict()` because a zod object STRIPS unknown keys.**
 * Non-strict, a line naming BOTH `accountRole` and `accountCode` parses cleanly
 * against `roleLine` - the union takes the first branch that fits - and the
 * `accountCode` is silently deleted before anything downstream sees it. That is
 * precisely the "money goes into one of two named accounts, quietly" case this
 * union exists to make unrepresentable, and it made `build-entry.ts`'s
 * both-at-once refusal unreachable from the wire. Strict, the line matches
 * neither branch and the request is refused.
 *
 * The cost is that a caller may send no extra keys at all. That is the intended
 * contract: `postingLineBase` is the whole of what a line is, and an unknown key
 * on a general-ledger line is a client that thinks it is writing something the
 * server does not read.
 *
 * Exported for `ledger-posting-line-schema.test.ts` only - nothing else imports
 * it, and it is not part of any client surface.
 */
export const postingLine = z.union([roleLine, codeLine])

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
  /**
   * Every declared type, `manual_journal` and `opening_balance` included since
   * HANDOFF slot 0B. What is ENABLED is a separate question and `regime.ts`
   * answers it; this enum is the vocabulary, not the permission.
   */
  postingType: z.enum(POSTING_TYPES),
  /**
   * `'2026-08'` for a month, `'2026-08-18'` for a day. `parsePeriodKey` owns the
   * keyspace.
   *
   * ⚠️ Not always a period: `manual_journal`, `bank_deposit` and `write_off`
   * key on the source record's own NUMBER (`'JNL-0007'`), because many can post
   * in one day and a date key would make the second collide with the first on
   * the claim's unique index. `doc-number.ts` is the authority.
   */
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
 * Distinct from {@link postingLine} on purpose. That one is a posting line and
 * carries the audit pair (`sourceType` / `sourceId`) and a `sortOrder`; this one
 * is what a person typed, and its source pair is the record itself while its
 * order is the array's. Making the drawer supply four fields it cannot know
 * before the entry is saved would be the worse shape.
 *
 * 🛑 `amountMinor` is INTEGER MINOR UNITS. Dollars never cross this wire:
 * `toMinorUnits` from `@auxx/lib/postings/client` is the single conversion and
 * it runs in the browser, at the `CurrencyInput` boundary. Zod checks that it is
 * a number and no more, for `postingLine`'s reason - `buildManualEntry` refuses
 * a zero, a negative and a fraction of a cent, and it names the ROW while doing
 * it, which a Zod issue cannot.
 */
const journalEntryLine = z.object({
  /** A code out of this org's own chart, e.g. `'6300'`. */
  accountCode: z.string().min(1),
  direction: z.enum(['debit', 'credit']),
  /** Integer minor units, > 0. The debit/credit column carries the sign. */
  amountMinor: z.number(),
  memo: z.string().max(1000).optional(),
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
   * Reached through `GlPostingLine.sourceType` / `sourceId`, which every builder
   * stamps on every line. `sourceType` is a free string rather than an enum on
   * purpose: it names the KIND of row that produced the line and new kinds
   * arrive with new builders, so an enum here would have to be edited in
   * lockstep with a vocabulary this router does not own. There is nothing to
   * leak - both halves are scoped to the caller's organization in SQL.
   */
  listPostingsForSource: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ sourceType: z.string().min(1), sourceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await listPostingsForSource(ctx.db, {
        organizationId: ctx.session.organizationId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
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
          kind: z.enum(['manual', 'opening_balance', 'recurring_template']).optional(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
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
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
            .optional(),
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
            kind: z.enum(['manual', 'opening_balance', 'recurring_template']).optional(),
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
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
            .optional(),
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
})
