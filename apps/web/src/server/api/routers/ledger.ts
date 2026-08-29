// apps/web/src/server/api/routers/ledger.ts

import { PermissionKey } from '@auxx/lib/permissions'
import {
  buildEntry,
  listUnpostedPeriods,
  POSTING_TYPES,
  postEntry,
  previewEntry,
  resolvePeriodLock,
  reverseEntry,
  verifyBooksBalance,
} from '@auxx/lib/postings'
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
