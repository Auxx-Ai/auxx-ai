// packages/lib/src/accounting/purchasing/landed-cost/cleared.ts

/**
 * What a goods bill's landed cost has already been CLEARED by, read off the
 * `landed_cost_clear` postings themselves (74 D4).
 *
 * 🛑 Off the ledger, never off a flag on the bill. The payment gate makes the
 * same call for the same reason (73 D1): a reversal takes the entry back out of
 * the books and a mirrored column would still say it was cleared, so the
 * remaining would never come back and a late carrier bill would post to `ppv`
 * on evidence that no longer exists.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, ne } from 'drizzle-orm'
import { VENDOR_BILL_SOURCE_TYPE } from '../../ledger/builders/entry'
import { countPostingsForLineSource } from '../../ledger/reads/read-posting'

/** The posting type a clear claims, and the source type its lines carry. */
export const LANDED_COST_CLEAR_POSTING_TYPE = 'landed_cost_clear' as const

/**
 * Every `landed_cost_clear` posting standing against this goods bill, as the
 * debit total per `gl_account` id.
 *
 * A reversed posting is excluded and a DRAFT one is not: a draft holds the
 * claim and is what the outbox is about to approve, so counting it is what
 * stops a second Clear being offered while the first waits for review -
 * `findLiveSubjectPosting` draws the same line.
 */
export async function readClearedByAccount(
  db: Database,
  organizationId: string,
  goodsBillInstanceId: string
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      glAccountId: schema.GlPostingLine.glAccountId,
      amountMinor: schema.GlPostingLine.amountMinor,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, LANDED_COST_CLEAR_POSTING_TYPE),
        ne(schema.GlPosting.status, 'reversed'),
        eq(schema.GlPostingLine.sourceType, VENDOR_BILL_SOURCE_TYPE),
        eq(schema.GlPostingLine.sourceId, goodsBillInstanceId),
        eq(schema.GlPostingLine.direction, 'debit')
      )
    )

  const byAccount = new Map<string, number>()
  for (const row of rows) {
    byAccount.set(row.glAccountId, (byAccount.get(row.glAccountId) ?? 0) + row.amountMinor)
  }
  return byAccount
}

/**
 * How many `landed_cost_clear` postings this goods bill has ever produced - the
 * attempt the next clear's occurrence and period key are keyed on.
 *
 * Counted over every posting including the reversed ones, so a reversed attempt
 * never has its key re-claimed by the next one.
 */
export async function countClearPostings(
  db: Database,
  organizationId: string,
  goodsBillInstanceId: string
): Promise<number> {
  return countPostingsForLineSource(db, organizationId, {
    sourceType: VENDOR_BILL_SOURCE_TYPE,
    sourceId: goodsBillInstanceId,
    postingType: LANDED_COST_CLEAR_POSTING_TYPE,
  })
}
