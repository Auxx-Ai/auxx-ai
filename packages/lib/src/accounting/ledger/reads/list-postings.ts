// packages/lib/src/accounting/ledger/reads/list-postings.ts

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

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toDateKey, toIso } from '@auxx/utils/calendar-day'
import { and, count, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../../errors'
import type { PostingSummary } from '../../journals/entries/client'
import { monthBounds } from '../periods/periods'
import type { PostingLinkRole, PostingStatus, PostingType } from '../types'

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
const CLOSE_POSTING_TYPE: PostingType = 'month_end_reversal'

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
 *
 * 🛑 `status` narrows in SQL, BEFORE `limit`. The Outbox's Drafts tab is
 * unbounded by month, and filtering drafts out of an already-capped page of
 * postings would hide every draft older than the newest 200 rows.
 */
export async function listPostings(
  db: Database,
  options: {
    organizationId: string
    periodKey?: string | null
    status?: PostingStatus
    limit?: number
    offset?: number
  }
): Promise<Result<PostingSummary[], Error>> {
  const { organizationId, periodKey, status, limit = DEFAULT_LIMIT, offset = 0 } = options

  try {
    // A malformed month is still an error. Only an ABSENT one widens the read:
    // 'not a month' and 'every month' must never be the same answer, or a typo
    // in a period key would silently return the whole ledger.
    let bounds: { first: string; next: string } | null = null
    if (periodKey != null) {
      try {
        bounds = monthBounds(periodKey)
      } catch {
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
          ...(status ? [eq(schema.GlPosting.status, status)] : []),
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
      .offset(offset)

    return ok(rows.map(toSummary))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list postings', { error, organizationId, periodKey })
    return err(new AuxxError('Internal error'))
  }
}

/** Drafts awaiting approval across every period - the Outbox tab badge, counted in SQL. */
export async function countDraftPostings(db: Database, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.status, 'draft'),
        ne(schema.GlPosting.postingType, CLOSE_POSTING_TYPE)
      )
    )
  return row?.total ?? 0
}

/** A posting plus the `GlPostingSource` role it was found through. */
export interface SourcePosting extends PostingSummary {
  linkRole: PostingLinkRole
  occurrence: string
}

/**
 * Every posting one record produced, newest first - the ledger card on an
 * order, an invoice, a fulfillment, a payout or a journal entry.
 *
 * Reached through `GlPostingSource`, never a stamp field on the record and never
 * `GlPostingLine.sourceType` (TARGET §1): one query, one component, every link
 * role. A row's `linkRole` says HOW it matched - `subject` is what the entry is
 * of, `parent` is an order listing its children's postings, `member` is what a
 * summed entry rolled up - so a card can group instead of pretending the four
 * are the same thing.
 *
 * Two queries rather than a join with `DISTINCT`, so the header columns come
 * back once per posting instead of once per link.
 */
export async function listPostingsForSource(
  db: Database,
  options: {
    organizationId: string
    sourceKind: string
    sourceId: string
    limit?: number
  }
): Promise<Result<SourcePosting[], Error>> {
  const { organizationId, sourceKind, sourceId, limit = DEFAULT_LIMIT } = options

  try {
    const links = await db
      .select({
        glPostingId: schema.GlPostingSource.glPostingId,
        linkRole: schema.GlPostingSource.linkRole,
        occurrence: schema.GlPostingSource.occurrence,
      })
      .from(schema.GlPostingSource)
      .where(
        and(
          eq(schema.GlPostingSource.organizationId, organizationId),
          eq(schema.GlPostingSource.sourceKind, sourceKind),
          eq(schema.GlPostingSource.sourceId, sourceId)
        )
      )
      .limit(limit)

    if (links.length === 0) return ok([])
    const roleByPosting = new Map(links.map((link) => [link.glPostingId, link]))

    const rows = await db
      .select(POSTING_COLUMNS)
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          inArray(schema.GlPosting.id, [...roleByPosting.keys()])
        )
      )
      .orderBy(desc(schema.GlPosting.createdAt))

    return ok(
      rows.map((row) => {
        const link = roleByPosting.get(row.id)
        return {
          ...toSummary(row),
          linkRole: (link?.linkRole ?? 'subject') as PostingLinkRole,
          occurrence: link?.occurrence ?? 'original',
        }
      })
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list postings for source', {
      error,
      organizationId,
      sourceKind,
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
  built: schema.GlPosting.built,
  postedAt: schema.GlPosting.postedAt,
}

type PostingRow = {
  id: string
  postingType: string
  periodKey: string
  txnDate: Date | string
  docNumber: string | null
  status: string
  revision: number
  reversesId: string | null
  totalMinor: string | number
  built: unknown
  postedAt: Date | string | null
}

function toSummary(row: PostingRow): PostingSummary {
  return {
    id: row.id,
    postingType: row.postingType as PostingType,
    periodKey: row.periodKey,
    txnDate: toDateKey(row.txnDate),
    docNumber: row.docNumber ?? '',
    status: row.status as PostingSummary['status'],
    revision: row.revision,
    reversesId: row.reversesId ?? null,
    // The header's own recorded total, NOT a sum of the lines. See the header.
    totalMinor: typeof row.totalMinor === 'number' ? row.totalMinor : Number(row.totalMinor),
    memo: readBuiltMemo(row.built),
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
function readBuiltMemo(built: unknown): string | null {
  if (typeof built !== 'object' || built === null) return null
  const memo = (built as Record<string, unknown>).memo
  return typeof memo === 'string' && memo ? memo : null
}

/**
 * The one posting that currently holds a source's subject claim, or `null`.
 *
 * The read every "reverse this record's entry" path makes first: a reversal
 * deletes the original's subject row, so anything still `subject` and not
 * `reversed` is what is standing in the books right now.
 */
export async function findLiveSubjectPosting(
  db: Database,
  options: {
    organizationId: string
    sourceKind: string
    sourceId: string
    /** Narrow to one pass over the source - a write-off attempt, say. */
    occurrence?: string
  }
): Promise<Result<SourcePosting | null, Error>> {
  const found = await listPostingsForSource(db, options)
  if (found.isErr()) return err(found.error)
  const live = found.value.find(
    (posting) =>
      posting.linkRole === 'subject' &&
      posting.status !== 'reversed' &&
      (options.occurrence === undefined || posting.occurrence === options.occurrence)
  )
  return ok(live ?? null)
}

/** A posting header paired with the `GlPostingSource` row it was found through. */
export interface LinkedPosting {
  sourceKind: string
  sourceId: string
  linkRole: PostingLinkRole
  occurrence: string
  glPostingId: string
  postingType: PostingType
  status: PostingStatus
  /** Null while the entry is a draft: a draft holds no claim and gets no number. */
  docNumber: string | null
  /** The accounting date, `YYYY-MM-DD`. */
  txnDate: string
  totalMinor: number
}

/** Which sources to look up, and how the link must read. */
export interface FindLinkedPostingsOptions {
  /** Omit to match any kind - `sourceIds` then carries the whole narrowing. */
  sourceKind?: string
  sourceIds: readonly string[]
  linkRole: PostingLinkRole | readonly PostingLinkRole[]
  postingTypes?: readonly PostingType[]
  /**
   * 🛑 REQUIRED, and with no default. The copies this replaced disagreed -
   * `posted`, `ne reversed`, or no filter at all - and for a `parent` or
   * `member` link the three give different answers, because only a `subject`
   * row is deleted by the reversal. A caller that wants any status says so.
   */
  statuses: readonly PostingStatus[]
}

/**
 * Postings linked to a set of sources, in one query.
 *
 * Reached through `GlPostingSource`, never a stamp field on the record and
 * never `GlPostingLine.sourceType` (TARGET §1).
 */
export async function findLinkedPostings(
  db: Database | Transaction,
  organizationId: string,
  options: FindLinkedPostingsOptions
): Promise<LinkedPosting[]> {
  const { sourceKind, sourceIds, linkRole, postingTypes, statuses } = options
  const ids = [...new Set(sourceIds)]
  if (ids.length === 0 || statuses.length === 0) return []
  const roles = Array.isArray(linkRole) ? [...linkRole] : [linkRole as PostingLinkRole]

  const rows = await db
    .select({
      sourceKind: schema.GlPostingSource.sourceKind,
      sourceId: schema.GlPostingSource.sourceId,
      linkRole: schema.GlPostingSource.linkRole,
      occurrence: schema.GlPostingSource.occurrence,
      glPostingId: schema.GlPosting.id,
      postingType: schema.GlPosting.postingType,
      status: schema.GlPosting.status,
      docNumber: schema.GlPosting.docNumber,
      txnDate: schema.GlPosting.txnDate,
      totalMinor: schema.GlPosting.totalMinor,
      createdAt: schema.GlPosting.createdAt,
    })
    .from(schema.GlPostingSource)
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.organizationId, schema.GlPostingSource.organizationId),
        eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId)
      )
    )
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        ...(sourceKind ? [eq(schema.GlPostingSource.sourceKind, sourceKind)] : []),
        inArray(schema.GlPostingSource.sourceId, ids),
        roles.length === 1
          ? eq(schema.GlPostingSource.linkRole, roles[0] as PostingLinkRole)
          : inArray(schema.GlPostingSource.linkRole, roles),
        ...(postingTypes?.length ? [inArray(schema.GlPosting.postingType, [...postingTypes])] : []),
        statuses.length === 1
          ? eq(schema.GlPosting.status, statuses[0] as PostingStatus)
          : inArray(schema.GlPosting.status, [...statuses])
      )
    )
    // Newest first, so a caller that keeps one row per source keeps the latest
    // rather than whatever the planner happened to emit first.
    .orderBy(desc(schema.GlPosting.createdAt), desc(schema.GlPosting.id))

  return rows.map(({ createdAt: _createdAt, ...row }) => ({
    ...row,
    linkRole: row.linkRole as PostingLinkRole,
    postingType: row.postingType as PostingType,
    status: row.status as PostingStatus,
  }))
}

/** The statuses a live subject row can carry. A reversal deletes the row itself. */
const LIVE_SUBJECT_STATUSES = ['draft', 'posted'] as const satisfies readonly PostingStatus[]

/**
 * The posting that currently holds each source's subject claim, batched.
 *
 * A reversal deletes the original's subject row (`markReversedInTx`), so
 * anything still `subject` is what stands in the books right now. `draft` stays
 * in the status filter although a draft's subject is written as `pending` since
 * #2274: callers that want only the POSTED ones filter the returned `status`.
 */
export async function findLiveSubjectPostings(
  db: Database | Transaction,
  organizationId: string,
  options: { sourceKind: string; sourceIds: readonly string[] }
): Promise<Map<string, LinkedPosting>> {
  const rows = await findLinkedPostings(db, organizationId, {
    sourceKind: options.sourceKind,
    sourceIds: options.sourceIds,
    linkRole: 'subject',
    statuses: LIVE_SUBJECT_STATUSES,
  })
  const bySource = new Map<string, LinkedPosting>()
  for (const row of rows) if (!bySource.has(row.sourceId)) bySource.set(row.sourceId, row)
  return bySource
}
