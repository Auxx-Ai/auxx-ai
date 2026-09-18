// packages/lib/src/postings/verify-balance.ts
//
// The two after-the-fact sweeps over the ledger: does every posted entry tie,
// and what is still not posted.
//
// ## Why a sweep exists at all
//
// Postgres does not enforce SUM(debit) = SUM(credit). It cannot with a check
// constraint - the invariant spans rows in a child table - and the only thing
// that could is a trigger. There is NO trigger precedent anywhere in this repo,
// and inventing one here would put a piece of business logic somewhere no
// TypeScript reader will ever look for it and no test in this package can reach.
// So the guarantee is deliberately three-part, in depth:
//
//   1. **`buildEntry` refuses to build one.** The only way to obtain a
//      `BuiltEntry` is that function, and it throws rather than return an
//      unbalanced entry. This catches every builder bug at the source.
//   2. **The poster re-asserts in-transaction, before commit.** `buildEntry`'s
//      guarantee is about the value it returned; the poster's is about the rows
//      it is a moment away from writing, after role resolution and line
//      construction have had their chance to drop or duplicate a line.
//   3. **This file proves it afterwards, across every posted entry.** Layers 1
//      and 2 are assertions about code paths that ran. This one is an assertion
//      about what is actually in the database, including rows written by an
//      older version of that code, by a migration, or by hand.
//
// Only the third survives a bug in the first two, which is the entire reason it
// is here. It is cheap: at roughly thirty entries a month a full-ledger sweep is
// a few hundred rows a year.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toMinor } from '@auxx/utils/currency'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'
import { countUnissuedChannelCreditMemos } from '../money/credit-memos/reads'
import type { BooksBalanceDiscrepancy, BooksBalanceReport, PostingType } from './types'

const logger = createScopedLogger('postings:verify-balance')

/**
 * The statuses that count as "in the books" for the balance sweep.
 *
 * `pending` is excluded because a claimed row legitimately has no lines yet:
 * the claim and the line inserts share one transaction, but a run that crashed
 * between them leaves exactly that shape, and so does any concurrent reader
 * peeking mid-transaction. Reporting those as unbalanced would make the sweep
 * cry wolf on its most common non-event, and a check nobody believes is worse
 * than no check.
 *
 * `failed` is excluded because it is not in the books: nothing was posted, the
 * financial statements do not include it, and its lines (if any) are the debris
 * of an attempt rather than a claim about money.
 *
 * `reversed` IS included. It is a posted entry whose effect was cancelled by a
 * second, opposite entry (decision G4); the original's own lines still have to
 * tie, and the reversal is an ordinary `posted` row that ties on its own. A
 * reversal pair therefore contributes two balanced entries, not one net-zero
 * one.
 */
const POSTED_STATUSES = ['posted', 'reversed'] as const

/** One entry whose lines do not tie, or do not agree with its recorded total. */
// `BooksBalanceDiscrepancy` moved to `types.ts` - see the note there.
// `BooksBalanceReport` moved to `types.ts` - see the note there.
export type { BooksBalanceDiscrepancy, BooksBalanceReport } from './types'

/**
 * Prove Sigma debit = Sigma credit across every posted entry.
 *
 * Three conditions make an entry a discrepancy, and all three are checked
 * because they fail differently:
 *
 * | Condition | What it means |
 * | --- | --- |
 * | `debit <> credit` | the entry does not tie. The classic. |
 * | `debit <> totalMinor` | the lines tie each other but not the header, so the ledger and the entry disagree about how big it is |
 * | no lines at all | a posted header with nothing under it - a header-only row, which reads as a perfectly balanced 0 = 0 unless the recorded total is compared |
 *
 * The third is why the join is a LEFT JOIN. An INNER JOIN would drop a posted
 * entry that has no lines from the result set entirely, and a sweep that cannot
 * see the rows it is looking for reports `balanced: true` for exactly the
 * corruption it exists to find.
 *
 * The grouped sums are done in SQL, in one pass. The comparison is done in
 * TypeScript rather than as a `HAVING` clause because `postingsChecked` is part
 * of the report: "0 discrepancies out of 0 entries checked" and "0 out of 412"
 * are very different answers and the banner has to be able to tell them apart.
 *
 * Indexes: `GlPostingLine_glPostingId_idx` carries the join and
 * `GlPosting_org_status_idx` carries the filter. Nothing new is needed.
 *
 * `options.month` adds the COMPLETENESS half for one month - see
 * {@link countIncompleteRevenue}. It is optional because balance is answerable
 * without it, and the two callers genuinely differ: the close console asks about
 * the month it is showing, while `useAccountingSettingsFreeze` only wants
 * `postingsChecked` and has no month in hand.
 */
export async function verifyBooksBalance(
  db: Database,
  organizationId: string,
  options?: { month?: string }
): Promise<Result<BooksBalanceReport, Error>> {
  try {
    const rows = await db
      .select({
        glPostingId: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        postingType: schema.GlPosting.postingType,
        periodKey: schema.GlPosting.periodKey,
        recordedTotalMinor: schema.GlPosting.totalMinor,
        // SUM over a bigint column returns `numeric`, which the driver hands
        // back as a STRING. Coalesced here so a header with no lines is 0 rather
        // than null, and coerced below rather than trusted as a number.
        totalDebitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
        totalCreditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
      })
      .from(schema.GlPosting)
      // LEFT, not INNER. See the JSDoc: a posted header with no lines is the one
      // corruption an INNER JOIN would hide.
      .leftJoin(schema.GlPostingLine, eq(schema.GlPostingLine.glPostingId, schema.GlPosting.id))
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          inArray(schema.GlPosting.status, [...POSTED_STATUSES])
        )
      )
      .groupBy(schema.GlPosting.id)

    const discrepancies: BooksBalanceDiscrepancy[] = []
    for (const row of rows) {
      const totalDebitMinor = toMinor(row.totalDebitMinor)
      const totalCreditMinor = toMinor(row.totalCreditMinor)
      const recordedTotalMinor = toMinor(row.recordedTotalMinor)

      if (totalDebitMinor === totalCreditMinor && totalDebitMinor === recordedTotalMinor) continue

      discrepancies.push({
        glPostingId: row.glPostingId,
        docNumber: row.docNumber,
        postingType: row.postingType as PostingType,
        periodKey: row.periodKey,
        totalDebitMinor,
        totalCreditMinor,
        recordedTotalMinor,
      })
    }

    if (discrepancies.length > 0) {
      // Loud, because there is no automatic repair for this and there should not
      // be one: an unbalanced posted entry is corrected by a reversing entry a
      // person decides to write, exactly as a bad stock movement is.
      logger.error('General ledger does not balance', {
        organizationId,
        postingsChecked: rows.length,
        discrepancyCount: discrepancies.length,
        glPostingIds: discrepancies.map((d) => d.glPostingId).join(','),
      })
    }

    const completeness = await countIncompleteRevenue(db, organizationId, options?.month)

    return ok({
      balanced: discrepancies.length === 0,
      postingsChecked: rows.length,
      discrepancies,
      ...completeness,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to verify that the books balance', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * The completeness half of the report: what one month still owes the ledger
 * (49 §2.4, §8.4 decision 7).
 *
 * 🛑 Balance and completeness are different questions and the sweep above
 * answers only the first. Every entry can tie while a month is missing a week of
 * revenue, which is precisely the state a connector-fed organization lands in -
 * the shipments are logged and nothing has posted them. These three counts are
 * the same three the close refuses on (`close-month.ts`), read here so the
 * banner warns before somebody presses Post rather than after.
 *
 * The third, `unpostedCreditMemos` (25 §9.1), is the issued memo whose entry has
 * not been written yet. It is a different question from the draft count beside
 * it and neither covers the other: one is a refund nobody has decided about, the
 * other a refund already granted whose contra-revenue is still outside the
 * books.
 *
 * ⚠️ Returns `null`s, never zeros, when no month was asked. A `0` in that slot
 * would read as "nothing outstanding" for a question nobody asked, and the
 * banner would quietly assert completeness it never checked.
 *
 * ⚠️ A failed count is also `null`, and it does NOT fail the sweep. The balance
 * result is the important half and it has already been computed; losing it
 * because a subledger read threw would take away the report that proves the
 * books tie in order to report the one that says they might be short.
 */
async function countIncompleteRevenue(
  db: Database,
  organizationId: string,
  month: string | undefined
): Promise<
  Pick<
    BooksBalanceReport,
    'month' | 'unpostedShipments' | 'unissuedChannelCreditMemos' | 'unpostedCreditMemos'
  >
> {
  if (!month) {
    return {
      month: null,
      unpostedShipments: null,
      unissuedChannelCreditMemos: null,
      unpostedCreditMemos: null,
    }
  }

  try {
    // `unpostedShipments` and `unpostedCreditMemos` are `null` - unavailable,
    // not zero - now that both avenues post eagerly (step 1b, TARGET §1): the
    // batch/effect backlog this used to count no longer exists. TODO(step-1b):
    // recompute from live drafts once the per-avenue `accounting.autoPost`
    // setting lands.
    const memos = await countUnissuedChannelCreditMemos(db, { organizationId, month })
    return {
      month,
      unpostedShipments: null,
      unissuedChannelCreditMemos: memos,
      unpostedCreditMemos: null,
    }
  } catch (error) {
    logger.error('Failed to count what the month still owes the ledger', {
      error,
      organizationId,
      month,
    })
    return {
      month,
      unpostedShipments: null,
      unissuedChannelCreditMemos: null,
      unpostedCreditMemos: null,
    }
  }
}
