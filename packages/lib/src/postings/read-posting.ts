// packages/lib/src/postings/read-posting.ts

/**
 * Read one posted entry back, exactly as it was written.
 *
 * The close console's posting drawer is deep-linked on `?posting=<id>` and needs
 * the header, its lines, the stored draft and the provider result in ONE call.
 * Before this function there was no read surface for a `GlPosting` anywhere -
 * not in the router, not in lib. `listUnpostedPeriods` answers "what is still
 * claimed but not in the books" and `verifyBooksBalance` answers "does the
 * ledger tie"; neither can show a reader what a single entry actually says.
 *
 * ## The one rule this file exists to keep: nothing is re-derived
 *
 * Every value returned here is READ BACK, never recomputed. Three of them are
 * the ones a well-meaning improvement would recompute, and each would corrupt
 * the reading in a way the screen could not detect:
 *
 * 1. **`draft` is returned verbatim, as `unknown`.** It carries task 09's
 *    assertion pair (`assertions.before` / `assertions.after`), which the
 *    roll-forward panel renders. A posted entry asserts what the world looked
 *    like WHEN IT WAS POSTED, and a reversal SWAPS that pair rather than
 *    recomputing it - so re-deriving the assertions by reading the subledger
 *    would make a reversed month render as though it had never been reversed.
 *    Parsing is the caller's decision (`parsePostingDraft` in `draft.ts`), not
 *    this reader's: a drawer that wants the typed envelope asks for it, and a
 *    caller that only wants to hand the blob to an auditor is not forced
 *    through a validator that could refuse a legacy row.
 * 2. **`accountName` is the snapshot on the line.** `GlPostingLine.accountName`
 *    is frozen at posting time for the same reason a movement's cost is frozen.
 *    Joining the live `gl_account` chart to "improve" it would silently restate
 *    history the moment somebody renames an account - which is the exact failure
 *    decision `G8` stores `accountRole` to prevent. There is no join to the
 *    chart in this file, and there must never be one.
 * 3. **`totalMinor` is the header's own recorded total**, not `SUM(lines)`. If
 *    the two disagree the drawer must show the disagreement, because that is a
 *    real corruption and `verifyBooksBalance` is the sweep that reports it.
 *    Summing the lines here would paper over it in the one view a person opens
 *    to investigate.
 *
 * ## Scope
 *
 * Both queries filter on `organizationId`. A posting id from another org is a
 * `NotFoundError`, not a leak and not a `ForbiddenError` - "this id exists but
 * is not yours" is itself a disclosure.
 *
 * Two queries, never N+1: the header, then every line for it in one read
 * ordered by `lineNumber`. `GlPostingLine_posting_lineNumber_key` carries the
 * order for free.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, NotFoundError } from '../errors'
import type { PostingDetail, PostingDetailLine, PostingDirection, PostingType } from './types'

const logger = createScopedLogger('postings:read-posting')

/**
 * One posted entry - header, lines, stored draft and provider result.
 *
 * Returns `NotFoundError` for an id that does not exist AND for one that belongs
 * to another organization. The two are deliberately indistinguishable.
 *
 * Timestamps are serialised as ISO strings and `txnDate` stays `YYYY-MM-DD`.
 * `txnDate` is a Postgres `date`, which carries no time and no zone: turning it
 * into an instant here would push it across a day boundary for any reader east
 * or west of the driver's assumption, and the accounting date is the one value
 * in the entry that must not move.
 *
 * @param db a `Database` or a transaction handle - this is a plain read.
 * @param organizationId the scope. Every query filters on it.
 * @param id the `GlPosting` row id.
 */
export async function getPosting(
  db: Database,
  organizationId: string,
  id: string
): Promise<Result<PostingDetail, Error>> {
  try {
    const [posting] = await db
      .select({
        id: schema.GlPosting.id,
        postingType: schema.GlPosting.postingType,
        periodKey: schema.GlPosting.periodKey,
        txnDate: schema.GlPosting.txnDate,
        docNumber: schema.GlPosting.docNumber,
        status: schema.GlPosting.status,
        revision: schema.GlPosting.revision,
        reversesId: schema.GlPosting.reversesId,
        currency: schema.GlPosting.currency,
        totalMinor: schema.GlPosting.totalMinor,
        draft: schema.GlPosting.draft,
        providerId: schema.GlPosting.providerId,
        providerEntryId: schema.GlPosting.providerEntryId,
        postedAt: schema.GlPosting.postedAt,
        postedByUserId: schema.GlPosting.postedByUserId,
        failureReason: schema.GlPosting.failureReason,
        attempts: schema.GlPosting.attempts,
        createdAt: schema.GlPosting.createdAt,
      })
      .from(schema.GlPosting)
      .where(and(eq(schema.GlPosting.organizationId, organizationId), eq(schema.GlPosting.id, id)))
      .limit(1)

    if (!posting) {
      return err(new NotFoundError('Posting not found', { glPostingId: id, organizationId }))
    }

    const lineRows = await db
      .select({
        id: schema.GlPostingLine.id,
        lineNumber: schema.GlPostingLine.lineNumber,
        accountCode: schema.GlPostingLine.accountCode,
        accountRole: schema.GlPostingLine.accountRole,
        accountName: schema.GlPostingLine.accountName,
        direction: schema.GlPostingLine.direction,
        amountMinor: schema.GlPostingLine.amountMinor,
        memo: schema.GlPostingLine.memo,
        sourceType: schema.GlPostingLine.sourceType,
        sourceId: schema.GlPostingLine.sourceId,
      })
      .from(schema.GlPostingLine)
      .where(
        and(
          eq(schema.GlPostingLine.organizationId, organizationId),
          eq(schema.GlPostingLine.glPostingId, id)
        )
      )
      .orderBy(asc(schema.GlPostingLine.lineNumber))

    const lines: PostingDetailLine[] = lineRows.map((row) => ({
      id: row.id,
      lineNumber: row.lineNumber,
      accountCode: row.accountCode,
      accountRole: row.accountRole ?? null,
      // The SNAPSHOT. Never the live chart. See the file header.
      accountName: row.accountName ?? null,
      direction: row.direction as PostingDirection,
      amountMinor: toMinor(row.amountMinor),
      memo: row.memo ?? null,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
    }))

    return ok({
      id: posting.id,
      postingType: posting.postingType as PostingType,
      periodKey: posting.periodKey,
      txnDate: toDateKey(posting.txnDate),
      docNumber: posting.docNumber,
      status: posting.status as PostingDetail['status'],
      revision: posting.revision,
      reversesId: posting.reversesId ?? null,
      currency: posting.currency,
      // The header's own recorded total, NOT a sum of the lines above.
      totalMinor: toMinor(posting.totalMinor),
      lines,
      // Verbatim. Unparsed on purpose.
      draft: posting.draft,
      providerId: posting.providerId ?? null,
      providerEntryId: posting.providerEntryId ?? null,
      postedAt: toIso(posting.postedAt),
      postedByUserId: posting.postedByUserId ?? null,
      failureReason: posting.failureReason ?? null,
      attempts: posting.attempts,
      createdAt: toIso(posting.createdAt) ?? '',
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read posting', { error, organizationId, glPostingId: id })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Serialise a timestamp column to ISO, tolerating a driver that already did.
 *
 * Drizzle maps `timestamp` to a `Date`, but a stub, a raw pool and a future
 * driver setting can all hand back the string form. Both arrive here rather than
 * at four call sites, and an unparseable value becomes `null` rather than the
 * string `'Invalid Date'`, which a screen would render as though it were a time.
 */
function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  const time = value.getTime()
  return Number.isNaN(time) ? null : value.toISOString()
}

/**
 * Keep a Postgres `date` as `YYYY-MM-DD`.
 *
 * Drizzle's `date()` is string-mode, so this is a pass-through in production.
 * The `Date` branch exists because the accounting date must never acquire a time
 * and a zone on its way to a browser: `new Date('2026-08-31').toISOString()` in
 * a negative-offset zone renders as August 30, and a month-end entry dated the
 * previous month is the one presentation bug a bookkeeper cannot argue with.
 * `toISOString().slice(0, 10)` is UTC by definition, which is what the column
 * already means.
 */
function toDateKey(value: Date | string): string {
  if (typeof value === 'string') return value
  return value.toISOString().slice(0, 10)
}

/**
 * Coerce a `bigint`-backed amount to integer minor units.
 *
 * `bigint({ mode: 'number' })` crosses the wire as a number through Drizzle, but
 * an aggregate or a raw driver read hands back the `numeric` string form. Same
 * reasoning as `verify-balance.ts`'s `toMinor`: handle both in one place rather
 * than trusting the driver at every field.
 */
function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
