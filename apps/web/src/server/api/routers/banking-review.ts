// apps/web/src/server/api/routers/banking-review.ts
//
// The bank review queue: listing bank transactions, the stat strip, the match
// candidates, and the four treatments plus undo
// (plans/bank-connection/03-categorization-and-gl.md; HANDOFF wave 3 slot 3B).
// Mounted as `bankingReview` in `root.ts`.
//
// 🛑 Reads are `ledgerView`; every treatment is `ledgerPost`. Match and exclude
// write no posting at all, and they are still `ledgerPost`: matching decides
// that a bank line is NOT a fresh expense, which is the same decision as coding
// it and has the same effect on what the books say. The rung follows the
// consequence, never the SQL.
//
// 🛑 Every refusal reaches the browser as an `AuxxError` verbatim and is
// rendered as an `EntryBlockers` card, never a toast (HANDOFF ground rule 9).
// Nothing here re-validates what the lib already refuses - a second authority
// drifts, and replacing "this bank line is void, the bank withdrew it" with
// "Could not save" throws away the only sentence that says what to do next.

import {
  codeTransaction,
  excludeTransaction,
  getBankTransaction,
  listForReview,
  listMatchCandidates,
  MATCHABLE_RECORD_TYPES,
  matchTransaction,
  REVIEW_QUEUE_STATES,
  readHistory,
  readQueueStats,
  transferTransaction,
  undoReview,
} from '@auxx/lib/banking/review'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/** `YYYY-MM-DD`. Shape only; the lib decides what is a sensible date. */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const transactionId = z.string().min(1)

/**
 * The queue's filters.
 *
 * ⚠️ `amountMin`/`amountMax` are SIGNED integer minor units, because
 * `bank_transaction.amountMinor` is - it mirrors the statement, and the bank
 * says `-1000`. A UI that wants "everything over $500 either way" sends two
 * queries or filters on the absolute value itself; inventing an unsigned
 * convention here would make the filter disagree with the column it filters.
 */
const listInput = z.object({
  bankAccountId: z.string().min(1).optional(),
  state: z.enum(REVIEW_QUEUE_STATES).optional(),
  search: z.string().max(200).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  amountMin: z.number().int().optional(),
  amountMax: z.number().int().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
})

export const bankingReviewRouter = createTRPCRouter({
  /** The queue itself, newest bank date first. */
  list: permissionProcedure(PermissionKey.ledgerView)
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const result = await listForReview(ctx.db, {
        organizationId: ctx.session.organizationId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The stat strip. Scoped to one account when the toolbar has one selected. */
  stats: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ bankAccountId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      const result = await readQueueStats(ctx.db, {
        organizationId: ctx.session.organizationId,
        bankAccountId: input.bankAccountId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** One line, for the drawer. Null when it has gone - an ordinary state. */
  get: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ id: transactionId }))
    .query(async ({ ctx, input }) => {
      const result = await getBankTransaction(ctx.db, {
        organizationId: ctx.session.organizationId,
        transactionId: input.id,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** What this line might be, best first. Sign-aware in the lib. */
  candidates: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ id: transactionId, search: z.string().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      const result = await listMatchCandidates(ctx.db, {
        organizationId: ctx.session.organizationId,
        transactionId: input.id,
        search: input.search,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Who reviewed it, when, under which rule, and what it posted. */
  history: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ id: transactionId }))
    .query(async ({ ctx, input }) => {
      const result = await readHistory(ctx.db, {
        organizationId: ctx.session.organizationId,
        transactionId: input.id,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Link a bank line to a document. **Posts nothing** (decision B5).
   *
   * `ledgerPost` even though no `GlPosting` is written: the decision that this
   * bank line is corroboration rather than a fresh expense is exactly as
   * consequential as coding it, and it freezes a deposit against edits.
   */
  match: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        id: transactionId,
        recordType: z.enum(MATCHABLE_RECORD_TYPES),
        recordId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await matchTransaction(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.user.id,
        transactionId: input.id,
        recordType: input.recordType,
        recordId: input.recordId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Post `Dr <code> / Cr <bank account>` and stamp the line `coded`. */
  code: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        id: transactionId,
        glAccountCode: z.string().min(1).max(64),
        contactRecordId: z.string().min(1).optional(),
        memo: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await codeTransaction(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.user.id,
        transactionId: input.id,
        glAccountCode: input.glAccountCode,
        contactRecordId: input.contactRecordId,
        memo: input.memo,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Both legs are ours: one cash-to-cash entry, filed on the outgoing leg. */
  transfer: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        id: transactionId,
        counterpartBankAccountId: z.string().min(1),
        memo: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await transferTransaction(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.user.id,
        transactionId: input.id,
        counterpartBankAccountId: input.counterpartBankAccountId,
        memo: input.memo,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Out of the queue, with a reason. The reason is required by the lib. */
  exclude: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ id: transactionId, reason: z.string().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const result = await excludeTransaction(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.user.id,
        transactionId: input.id,
        reason: input.reason,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Back to the queue. A coded line reverses its posting first. */
  undo: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ id: transactionId, memo: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await undoReview(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.user.id,
        transactionId: input.id,
        memo: input.memo,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Accept whatever slot 3C's miner proposed, for many lines at once.
   *
   * ⚠️ **A no-op with a sentence until 3C lands.** The suggestion fields
   * (`bank_transaction_suggested_gl_account`, `bank_transaction_suggestion_reason`)
   * belong to 3C; this reads them if they exist and codes the line to the
   * suggested account, and otherwise says that nothing was suggested rather
   * than guessing. 🛑 Guessing is the specific trap the bank plan names: a
   * plausible-looking wrong default gets accepted in bulk by a bookkeeper
   * clearing a 1,484-item backlog, and every one of those is a posting.
   */
  bulkAcceptSuggested: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ ids: z.array(transactionId).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const actorUserId = ctx.session.user.id
      const results: BulkOutcome[] = []

      for (const id of input.ids) {
        const line = await getBankTransaction(ctx.db, { organizationId, transactionId: id })
        if (line.isErr()) {
          results.push({ id, ok: false, message: line.error.message })
          continue
        }
        const suggested = line.value?.suggestedGlAccount
        if (!suggested) {
          results.push({
            id,
            ok: false,
            message: 'Nothing has been suggested for this line yet, so there is nothing to accept.',
          })
          continue
        }
        const coded = await codeTransaction(ctx.db, {
          organizationId,
          actorUserId,
          transactionId: id,
          glAccountCode: suggested,
          memo: line.value?.suggestionReason ?? undefined,
        })
        results.push(toBulkOutcome(id, coded))
      }
      return summarize(results)
    }),

  /** Exclude many lines with one reason. */
  bulkExclude: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({ ids: z.array(transactionId).min(1).max(200), reason: z.string().min(1).max(1000) })
    )
    .mutation(async ({ ctx, input }) => {
      const results: BulkOutcome[] = []
      for (const id of input.ids) {
        const result = await excludeTransaction(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.user.id,
          transactionId: id,
          reason: input.reason,
        })
        results.push(toBulkOutcome(id, result))
      }
      return summarize(results)
    }),

  /**
   * Code many lines to one account.
   *
   * ⚠️ Sequential, not `Promise.all`. Each line claims its own period tuple and
   * posts its own entry; running them concurrently would interleave claims on
   * one connection for no gain a person can perceive, and the failure of the
   * fourth line must not abandon the first three.
   */
  bulkAssignAccount: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        ids: z.array(transactionId).min(1).max(100),
        glAccountCode: z.string().min(1).max(64),
        memo: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results: BulkOutcome[] = []
      for (const id of input.ids) {
        const result = await codeTransaction(ctx.db, {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.user.id,
          transactionId: id,
          glAccountCode: input.glAccountCode,
          memo: input.memo,
        })
        results.push(toBulkOutcome(id, result))
      }
      return summarize(results)
    }),
})

/** One line's outcome inside a bulk action. */
interface BulkOutcome {
  id: string
  ok: boolean
  message?: string
  status?: string
}

/**
 * 🛑 A refused POST is a failure here even though the lib returned `ok`.
 * `postEntry` never throws, so a locked period arrives as a `PostResult` status
 * on the success path - counting it as a success would tell a bookkeeper that
 * forty lines posted when none did.
 */
function toBulkOutcome(
  id: string,
  result: {
    isErr: () => boolean
    error?: Error
    value?: { post: { status: string; error?: string } | null }
  }
): BulkOutcome {
  if (result.isErr()) return { id, ok: false, message: result.error?.message }
  const post = result.value?.post
  if (post && post.status !== 'posted' && post.status !== 'already_posted') {
    return { id, ok: false, status: post.status, message: post.error }
  }
  return { id, ok: true, status: post?.status }
}

/** What a bulk action answers with: the counts, and every refusal verbatim. */
function summarize(results: BulkOutcome[]) {
  const failed = results.filter((row) => !row.ok)
  return {
    total: results.length,
    succeeded: results.length - failed.length,
    failed: failed.length,
    // Verbatim, and every one of them: a bulk bar that reports "3 failed" with
    // no reasons sends the operator back through the list one row at a time.
    failures: failed.map((row) => ({ id: row.id, status: row.status, message: row.message })),
  }
}
