// packages/lib/src/postings/list-postings.ts

/**
 * The two `GlPosting` LIST reads: what is in a period, and what one record
 * produced.
 *
 * ## Why these did not exist before
 *
 * Under L1 the ledger page was a one-entry screen: a month held exactly one
 * posting, the month-end inventory assertion, and `listClosePeriods` answered
 * "which month has one" - which is a different question and cannot be made to
 * answer this one. `ledger.periods` returns CLOSE PERIODS, not postings. With
 * manual journal entries a month holds N postings and needs a list.
 *
 * ## Nothing here is re-derived
 *
 * The same rule `read-posting.ts` states at length. `totalMinor` is the
 * header's own recorded total and never `SUM(lines)`; if the two disagree that
 * is a real corruption and `verifyBooksBalance` is the sweep that reports it,
 * so summing here would paper over it in the list somebody opens to
 * investigate. `memo` is read off the stored draft envelope rather than
 * recomposed.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'
import type { PostingSummary } from './journal-entries/client'
import type { PostingType } from './types'

const logger = createScopedLogger('postings:list-postings')

/**
 * The posting type the close console renders inline, above this list.
 *
 * 🛑 Excluded rather than merged. The month-end inventory entry is not one
 * entry among many: it is what CLOSES the month, it carries the roll-forward
 * assertions the console renders, and it has its own Post button and its own
 * blockers. Listing it as a row beside three adjusting entries would give the
 * screen two places to post the same thing.
 */
const CLOSE_POSTING_TYPE: PostingType = 'month_end_inventory'

const DEFAULT_LIMIT = 200

/**
 * Every posting in one accounting month except the close entry, newest first.
 * With no `periodKey`, every posting the org has, newest first.
 *
 * ⚠️ **Matched on `txnDate`, not on `periodKey`.** For `manual_journal`,
 * `bank_deposit` and `write_off` the period key is the source record's own
 * NUMBER (`'JNL-0007'`) rather than a date - `doc-number.ts` says why, and it is
 * load-bearing, because many of them can post in one day. So the only field
 * that answers "what landed in August" is the accounting date, which every
 * posting type carries and which is the date whose financial statements a lock
 * is protecting.
 *
 * 🛑 **`periodKey` is OPTIONAL, and omitting it is not a convenience.** The
 * ledger page resolves no month at all for a finalized org whose cutoff is in
 * the future, and its Entries section is the only door to a manual journal
 * entry. Requiring a month there made every posting invisible on exactly the
 * screen a bookkeeper opens to find them, so "no month" lists the whole ledger
 * rather than nothing. `limit` still caps it.
 */
export async function listPostings(
  db: Database,
  options: { organizationId: string; periodKey?: string | null; limit?: number }
): Promise<Result<PostingSummary[], Error>> {
  const { organizationId, periodKey, limit = DEFAULT_LIMIT } = options

  try {
    // A malformed month is still an error. Only an ABSENT one widens the read:
    // 'not a month' and 'every month' must never be the same answer, or a typo
    // in a period key would silently return the whole ledger.
    let bounds: { first: string; next: string } | null = null
    if (periodKey != null) {
      bounds = monthBounds(periodKey)
      if (!bounds) {
        return err(new AuxxError(`'${periodKey}' is not an accounting month. Expected 'YYYY-MM'.`))
      }
    }

    const rows = await db
      .select(POSTING_COLUMNS)
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          ne(schema.GlPosting.postingType, CLOSE_POSTING_TYPE),
          // A Postgres `date` compares to a `YYYY-MM-DD` string directly
          // (drizzle's `date()` is string-mode), and the range is half-open so
          // the last day of the month is included and the first of the next is
          // not - which is right for every month length without a table.
          ...(bounds
            ? [
                gte(schema.GlPosting.txnDate, bounds.first),
                lt(schema.GlPosting.txnDate, bounds.next),
              ]
            : [])
        )
      )
      .orderBy(desc(schema.GlPosting.txnDate), desc(schema.GlPosting.createdAt))
      .limit(limit)

    return ok(rows.map(toSummary))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list postings', { error, organizationId, periodKey })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Every posting one record produced, newest first - the `ledger` card on an
 * order, an invoice, a payment or a journal entry.
 *
 * Reached through `GlPostingLine.sourceType` / `sourceId`, which every builder
 * stamps on every line (build plan 7.3): the pair is what makes a posting
 * explainable later without joining through a provider's API. Two queries
 * rather than a join with `DISTINCT`, so the header columns come back once per
 * posting instead of once per line.
 *
 * Includes the close entry, unlike {@link listPostings}: a stock movement
 * asking "what did I post to" genuinely wants the month-end assertion in the
 * answer, and there is no inline card above this one for it to duplicate.
 */
export async function listPostingsForSource(
  db: Database,
  options: {
    organizationId: string
    sourceType: string
    sourceId: string
    limit?: number
  }
): Promise<Result<PostingSummary[], Error>> {
  const { organizationId, sourceType, sourceId, limit = DEFAULT_LIMIT } = options

  try {
    const lines = await db
      .selectDistinct({ glPostingId: schema.GlPostingLine.glPostingId })
      .from(schema.GlPostingLine)
      .where(
        and(
          eq(schema.GlPostingLine.organizationId, organizationId),
          eq(schema.GlPostingLine.sourceType, sourceType),
          eq(schema.GlPostingLine.sourceId, sourceId)
        )
      )
      .limit(limit)

    const ids = lines.map((row) => row.glPostingId)
    if (ids.length === 0) return ok([])

    const rows = await db
      .select(POSTING_COLUMNS)
      .from(schema.GlPosting)
      .where(
        and(eq(schema.GlPosting.organizationId, organizationId), inArray(schema.GlPosting.id, ids))
      )
      .orderBy(desc(schema.GlPosting.createdAt))

    return ok(rows.map(toSummary))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list postings for source', {
      error,
      organizationId,
      sourceType,
      sourceId,
    })
    return err(new AuxxError('Internal error'))
  }
}

/** The header columns a {@link PostingSummary} is made of. Declared once. */
const POSTING_COLUMNS = {
  id: schema.GlPosting.id,
  postingType: schema.GlPosting.postingType,
  periodKey: schema.GlPosting.periodKey,
  txnDate: schema.GlPosting.txnDate,
  docNumber: schema.GlPosting.docNumber,
  status: schema.GlPosting.status,
  revision: schema.GlPosting.revision,
  reversesId: schema.GlPosting.reversesId,
  totalMinor: schema.GlPosting.totalMinor,
  draft: schema.GlPosting.draft,
  postedAt: schema.GlPosting.postedAt,
}

type PostingRow = {
  id: string
  postingType: string
  periodKey: string
  txnDate: Date | string
  docNumber: string
  status: string
  revision: number
  reversesId: string | null
  totalMinor: string | number
  draft: unknown
  postedAt: Date | string | null
}

function toSummary(row: PostingRow): PostingSummary {
  return {
    id: row.id,
    postingType: row.postingType as PostingType,
    periodKey: row.periodKey,
    txnDate: toDateKey(row.txnDate),
    docNumber: row.docNumber,
    status: row.status as PostingSummary['status'],
    revision: row.revision,
    reversesId: row.reversesId ?? null,
    // The header's own recorded total, NOT a sum of the lines. See the header.
    totalMinor: typeof row.totalMinor === 'number' ? row.totalMinor : Number(row.totalMinor),
    memo: readDraftMemo(row.draft),
    postedAt: toIso(row.postedAt),
  }
}

/**
 * The memo off the stored envelope, without parsing the whole thing.
 *
 * `parsePostingDraft` is strict on purpose and throws on an envelope it does not
 * recognise, which is right where the assertions matter and wrong here: a legacy
 * or hand-written draft must not make a LIST unopenable over a display string.
 */
function readDraftMemo(draft: unknown): string | null {
  if (typeof draft !== 'object' || draft === null) return null
  const memo = (draft as Record<string, unknown>).memo
  return typeof memo === 'string' && memo ? memo : null
}

/** The half-open `[first, next)` day keys of one accounting month, or null. */
function monthBounds(periodKey: string): { first: string; next: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  const pad = (value: number) => String(value).padStart(2, '0')
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return { first: `${year}-${pad(month)}-01`, next: `${nextYear}-${pad(nextMonth)}-01` }
}

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
 * and a zone on its way to a browser - see `read-posting.ts`'s note.
 */
function toDateKey(value: Date | string): string {
  if (typeof value === 'string') return value
  return value.toISOString().slice(0, 10)
}
