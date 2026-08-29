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
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'
import { compareMonths, periodMonth } from './periods'
import type {
  BooksBalanceDiscrepancy,
  BooksBalanceReport,
  PostingType,
  UnpostedPeriod,
} from './types'

const logger = createScopedLogger('postings:verify-balance')

/**
 * The statuses that count as "in the books" for the balance sweep.
 *
 * `pending` is excluded because a claimed row legitimately has no lines yet:
 * the claim and the line inserts share one transaction, but a run that crashed
 * between them leaves exactly that shape, and so does any concurrent reader
 * peeking mid-transaction. Reporting those as unbalanced would make the sweep
 * cry wolf on its most common non-event, and a check nobody believes is worse
 * than no check. They are not lost - `listUnpostedPeriods` is where they show up,
 * which is the report that can actually be acted on.
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
 */
export async function verifyBooksBalance(
  db: Database,
  organizationId: string
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

    return ok({
      balanced: discrepancies.length === 0,
      postingsChecked: rows.length,
      discrepancies,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to verify that the books balance', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

// `UnpostedPeriod` moved to `types.ts` - see the note there.
export type { UnpostedPeriod } from './types'

/**
 * Every entry that has been claimed but is not in the books.
 *
 * This is what the close console's "you have 3 unposted periods" banner reads.
 * Both non-terminal statuses are returned and they are kept distinct rather than
 * collapsed into "unposted", because they call for different actions:
 *
 *   * `pending` - claimed and in flight, or claimed by a run that died mid-push.
 *     Retryable; layer 2 of the idempotency ladder heals the dangerous half of
 *     it (posted at the provider, not recorded here).
 *   * `failed` - the push was attempted and refused. `failureReason` and
 *     `attempts` are the whole point of the row; a banner that hid them would
 *     send someone to the logs for a string that is already in the database.
 *
 * `through` bounds the result by accounting MONTH, inclusive: `{ through:
 * '2026-08' }` returns everything up to and including August. The comparison
 * goes through `periodMonth` so a day key (`'2026-08-18'`) is bounded by the
 * month that contains it rather than by a string compare against a differently
 * shaped key.
 *
 * An unparseable `periodKey` is INCLUDED regardless of `through`. `GlPosting`
 * documents that the column may hold a payout or build id rather than a date,
 * and such a row cannot be placed in a month at all. Dropping it would
 * under-report unposted work, and under-reporting is the dangerous direction
 * here: a bookkeeper who is not shown an unposted entry closes the month without
 * it, whereas one shown an extra row asks about it.
 *
 * Ordered by `periodKey` then `postingType` so the banner and the console list
 * agree with each other and with themselves between refreshes.
 */
export async function listUnpostedPeriods(
  db: Database,
  organizationId: string,
  options?: { through?: string }
): Promise<Result<UnpostedPeriod[], Error>> {
  try {
    // Normalized through `periodMonth`, which also VALIDATES: a malformed bound
    // throws `BadRequestError` here rather than silently matching nothing, and a
    // caller that passes a day key gets the month containing it.
    const throughMonth = options?.through ? periodMonth(options.through) : null

    const rows = await db
      .select({
        glPostingId: schema.GlPosting.id,
        periodKey: schema.GlPosting.periodKey,
        postingType: schema.GlPosting.postingType,
        status: schema.GlPosting.status,
        docNumber: schema.GlPosting.docNumber,
        attempts: schema.GlPosting.attempts,
        failureReason: schema.GlPosting.failureReason,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          inArray(schema.GlPosting.status, ['pending', 'failed'])
        )
      )
      .orderBy(asc(schema.GlPosting.periodKey), asc(schema.GlPosting.postingType))

    const unposted: UnpostedPeriod[] = []
    for (const row of rows) {
      if (throughMonth && !withinThrough(row.periodKey, throughMonth)) continue
      unposted.push({
        periodKey: row.periodKey,
        postingType: row.postingType as PostingType,
        glPostingId: row.glPostingId,
        status: row.status as 'pending' | 'failed',
        docNumber: row.docNumber,
        attempts: row.attempts,
        failureReason: row.failureReason,
      })
    }

    return ok(unposted)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list unposted periods', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Is `periodKey` at or before `throughMonth`?
 *
 * Returns `true` for a key that is not a period at all, for the reason spelled
 * out on `listUnpostedPeriods`: an entry that cannot be placed in a month must
 * not vanish from a report about unfinished work.
 */
function withinThrough(periodKey: string, throughMonth: string): boolean {
  try {
    return compareMonths(periodMonth(periodKey), throughMonth) <= 0
  } catch {
    return true
  }
}

/**
 * Coerce one aggregate to integer minor units.
 *
 * `bigint`/`numeric` cross the wire as strings, and the schema's own columns
 * cross as numbers because Drizzle maps them. Both arrive here, so both are
 * handled in one place rather than at four call sites. A value that is neither
 * is a driver change, and `NaN` would compare unequal to everything and be
 * reported as a discrepancy, which is the safe direction.
 */
function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
