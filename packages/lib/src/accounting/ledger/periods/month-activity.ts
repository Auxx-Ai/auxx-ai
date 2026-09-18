// packages/lib/src/accounting/ledger/periods/month-activity.ts

/**
 * What posted in one accounting month, per posting type, and what the month
 * still owes the two bulk dialogs
 * (`plans/accounting/tasks/done/28-how-your-books-post.md` §6).
 *
 * ## A fact per type, never an alarm
 *
 * §6's "This month" group is in the shape of the Processor fees block: one
 * row per posting type, a count and a date, and the person draws the
 * conclusion. So this read produces no status, no severity and no verdict.
 * `BooksGroup` stays the place for what did not tie; nothing here duplicates
 * the balance sweep or the close refusals.
 *
 * ## Two reads, one of them grouped
 *
 * 1. One grouped aggregate over `GlPosting`: POSTED entries with a txn date
 *    inside the month, counted per `postingType`, with the latest txn date.
 *    `status = 'posted'` excludes a reversed original the way
 *    `rail-fee-status.ts` and `duplicate-movements.ts` do: a reversal flips
 *    the entry it backs out to `reversed` in the same transaction, so at most
 *    one of a pair is ever posted.
 * 2. The two unposted counts the balance sweep already reads for
 *    `books-health.tsx` (`verify-balance.ts` `countIncompleteRevenue`):
 *    shipments and issued credit memos dated in the month whose entry has not
 *    been posted, which is what the fulfillment and credit memo bulk dialogs
 *    are for. The same functions are called here rather than re-queried, so
 *    the sidebar cannot disagree with the sweep about what is waiting.
 *
 * ## ⚠️ Matched on `txnDate`, never on `periodKey`
 *
 * `list-postings.ts` says why at length: for `manual_journal`, `bank_deposit`
 * and `write_off` the period key is the source record's NUMBER, not a date, so
 * the only field that answers "what landed in September" is the accounting
 * date. The month's bounds are derived through `parsePeriodKey`, and the range
 * is half-open on `YYYY-MM-DD` keys, which a Postgres `date` compares to
 * directly (drizzle's `date()` is string-mode) - no timezone arithmetic, and
 * therefore no UTC month masquerading as the book month.
 *
 * No permission checks here. The router asserts `ledgerView`
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../../../errors'
import type { PostingType } from '../types'
// 🛑 The LEAVES, never the `money/*` barrels, the same call `rail-fee-status.ts`
// makes: `postings/index.ts` re-exports this file, and a barrel that reaches
// back into `postings/` would close a cycle.
import { parsePeriodKey } from './periods'

const logger = createScopedLogger('postings:month-activity')

/** One posting type's posted entries in the month. Only types with at least one are listed. */
export interface PostingTypeActivity {
  postingType: PostingType
  /** POSTED entries with a txn date inside the month. Never zero: a type with none has no row. */
  count: number
  /** `YYYY-MM-DD` of the latest posted txn date inside the month. */
  lastTxnDate: string
}

export interface MonthActivity {
  /** `YYYY-MM` - the month asked about. */
  month: string
  /** In no particular order; the caller renders in policy declaration order. */
  byType: PostingTypeActivity[]
  /**
   * Shipments dated in the month with no posted fulfillment entry - what the
   * fulfillment bulk dialog would post. `null` when the count could not be
   * read, which is NOT zero: a zero says "nothing waiting" for a question that
   * got no answer.
   */
  unpostedShipments: number | null
  /** Issued credit memos dated in the month with no posted entry - what the credit memo bulk dialog would post. Same `null` rule. */
  unpostedCreditMemos: number | null
}

export interface ReadMonthActivityOptions {
  organizationId: string
  /** `YYYY-MM` - the month on screen. Required: every number here is about it. */
  month: string
}

/**
 * Per posting type, what POSTED in one month and when it last did.
 *
 * `unpostedShipments` and `unpostedCreditMemos` are always `null` -
 * unavailable, not zero - now that both avenues post eagerly (step 1b,
 * TARGET §1): the batch/effect backlog they used to count no longer exists.
 * TODO(step-1b): recompute from live drafts once the per-avenue
 * `accounting.autoPost` setting lands.
 */
export async function readMonthActivity(
  db: Database,
  options: ReadMonthActivityOptions
): Promise<Result<MonthActivity, Error>> {
  const { organizationId, month } = options

  try {
    const bounds = monthBounds(month)

    const rows = await db
      .select({
        postingType: schema.GlPosting.postingType,
        count: sql<number>`count(*)::int`,
        // `::text` for the same reason `rail-fee-status.ts` gives: the string
        // mapping of a `date()` column applies to a selected COLUMN, not to a
        // raw `max()` around one, which the driver hands back as a `Date`.
        lastTxnDate: sql<string>`(max(${schema.GlPosting.txnDate}))::text`,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.status, 'posted'),
          gte(schema.GlPosting.txnDate, bounds.first),
          lt(schema.GlPosting.txnDate, bounds.next)
        )
      )
      .groupBy(schema.GlPosting.postingType)

    return ok({
      month,
      byType: rows
        .filter((row) => row.count > 0)
        .map((row) => ({
          postingType: row.postingType,
          count: row.count,
          lastTxnDate: row.lastTxnDate,
        })),
      // `null` - unavailable, not zero - now that both avenues post eagerly
      // (step 1b, TARGET §1): the batch/effect backlog this used to count no
      // longer exists. TODO(step-1b): recompute from live drafts once the
      // per-avenue `accounting.autoPost` setting lands.
      unpostedShipments: null,
      unpostedCreditMemos: null,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the month activity', { error, organizationId, month })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * `'2026-09'` as a half-open range of date keys: its first day, and the first
 * day of the month after it. Right for every month length without a table,
 * and a December key rolls into January of the next year.
 *
 * @throws {BadRequestError} for anything but a real `YYYY-MM` month.
 */
function monthBounds(month: string): { first: string; next: string } {
  const parsed = parsePeriodKey(month)
  if (parsed.granularity !== 'month') {
    throw new BadRequestError(`Expected a YYYY-MM month, got "${month}"`, { month })
  }
  const nextYear = parsed.month === 12 ? parsed.year + 1 : parsed.year
  const nextMonth = parsed.month === 12 ? 1 : parsed.month + 1
  return {
    first: `${month}-01`,
    next: `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}
