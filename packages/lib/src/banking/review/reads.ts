// packages/lib/src/banking/review/reads.ts

/**
 * Every READ the bank review queue makes (HANDOFF slot 3B, bank plan ranks 8
 * and 9): the queue itself, its stat strip, the match candidates, and one
 * line's history.
 *
 * Reads only. The four treatments live in `writes.ts`, because a file that both
 * queries and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts `ledgerView`
 * or `ledgerPost` and hands the narrowed filters down (§6).
 *
 * 🛑 **Every filter narrows in SQL.** The queue this exists to clear is 2,390
 * rows on the real book it was designed against, reaching back eighteen months.
 * A post-read `.filter()` would pull every statement line in the org into memory
 * to answer a question about one account and one fortnight.
 */

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, gte, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { NotFoundError, UnprocessableEntityError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import { type BankAccountRow, toDateKey } from '../client'
import { guard } from '../guard'
import { listBankAccounts, readCoverage } from '../reads'
import {
  BANK_TRANSACTION_SOURCE_TYPE,
  type BankStatus,
  type BankTransactionRow,
  bankLineFlow,
  CANDIDATE_DAY_WINDOW,
  isWithinAmountTolerance,
  isWithinCandidateWindow,
  type MatchCandidate,
  type MatchedRecordType,
  type MatchRecordType,
  type ReviewHistoryEntry,
  type ReviewQueueState,
  type ReviewQueueStats,
  type ReviewStatus,
  scoreCandidate,
} from './client'

/** Every `bank_transaction` attribute a {@link BankTransactionRow} is assembled from. */
const TRANSACTION_ATTRIBUTES = [
  'bank_transaction_external_id',
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
  'bank_transaction_bank_status',
  'bank_transaction_match_key',
  'bank_transaction_import_batch_id',
  'bank_transaction_source',
  'bank_transaction_review_status',
  'bank_transaction_gl_account',
  'bank_transaction_matched_record_id',
  'bank_transaction_matched_record_type',
  'bank_transaction_exclude_reason',
  'bank_transaction_reviewed_at',
  'bank_transaction_reviewed_by_user_id',
  'bank_transaction_gl_posting_id',
  'bank_transaction_rule_id',
] as const

type TransactionAttribute = (typeof TRANSACTION_ATTRIBUTES)[number]
type TransactionFields = Record<TransactionAttribute, { id: string } | null>

/**
 * 3C's fields, read by NAME rather than through the typed cache.
 *
 * 🛑 These two are not in `SystemAttribute` yet - slot 3C adds them with the
 * `bank_rule` def (migration 125) - so `bySystemAttributes` cannot be asked for
 * them without a type error, and a closed union is the right place for that
 * error to be. Reading them off `CustomField` by string keeps this slot
 * independent of 3C's landing order: the queue works with no suggestion at all,
 * and the code panel prefills the moment the fields exist.
 *
 * The names are declared in HANDOFF §5 so 3C writes the same two.
 */
const SUGGESTION_ATTRIBUTE_NAMES = [
  'bank_transaction_suggested_gl_account',
  'bank_transaction_suggestion_reason',
] as const

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/** The resolved def and field ids every review read needs. */
export interface ReviewFieldContext {
  bankTransactionDefId: string
  fields: TransactionFields
  /** 3C's suggestion fields, keyed by attribute name. Empty until 3C lands. */
  suggestionFields: Record<string, string>
}

/**
 * Resolve the `bank_transaction` def and its fields, or `null` when the org has
 * not run entity migration 125 yet.
 *
 * `null` rather than a throw so the queue on an unmigrated org renders an empty
 * state instead of 500ing. The WRITE paths call {@link requireReviewFieldContext}
 * instead: a treatment that silently did nothing would be worse than a refusal.
 */
export async function loadReviewFieldContext(
  organizationId: string
): Promise<ReviewFieldContext | null> {
  const bankTransactionDefId = await getCachedEntityDefId(organizationId, 'bank_transaction')
  if (!bankTransactionDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...TRANSACTION_ATTRIBUTES])) as TransactionFields
  // Without `review_status` and `amount` there is no queue at all: the state
  // filter and every figure on the stat strip both reduce to nothing.
  if (!fields.bank_transaction_review_status || !fields.bank_transaction_amount) return null
  return { bankTransactionDefId, fields, suggestionFields: {} }
}

/** {@link loadReviewFieldContext}, as the refusal a write path needs. */
export async function requireReviewFieldContext(
  organizationId: string
): Promise<ReviewFieldContext> {
  const ctx = await loadReviewFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'The bank review queue is not available until the bank transaction entity and its ' +
        'fields are provisioned (entity migration 125)'
    )
  }
  return ctx
}

/** {@link loadReviewFieldContext} plus 3C's suggestion fields, when they exist. */
async function loadReviewFieldContextWithSuggestions(
  db: Database,
  organizationId: string
): Promise<ReviewFieldContext | null> {
  const ctx = await loadReviewFieldContext(organizationId)
  if (!ctx) return null
  const rows = await db
    .select({ id: schema.CustomField.id, attr: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, ctx.bankTransactionDefId),
        inArray(schema.CustomField.systemAttribute, [...SUGGESTION_ATTRIBUTE_NAMES])
      )
    )
  const suggestionFields: Record<string, string> = {}
  for (const row of rows) if (row.attr) suggestionFields[row.attr] = row.id
  return { ...ctx, suggestionFields }
}

/** What {@link listForReview} narrows on. Every one of them runs in SQL. */
export interface ListForReviewFilters {
  organizationId: string
  bankAccountId?: string
  /** One review status, or `'all'`. Defaults to `'for_review'`. */
  state?: ReviewQueueState
  /** Case-insensitive substring over `description` and `matchKey`. */
  search?: string
  /** `YYYY-MM-DD` inclusive bounds on `postedAt`. */
  from?: string
  to?: string
  /** Inclusive bounds on the SIGNED minor-unit amount. */
  amountMin?: number
  amountMax?: number
  limit?: number
  offset?: number
}

/**
 * An aliased `FieldValue` table, as `alias()` returns it.
 *
 * Copied from `money/bank-deposits/reads.ts` for the reason its comment gives:
 * composing with `eq` against the alias OBJECT makes drizzle emit the table as
 * an identifier, where a hand-written `sql` fragment interpolating it binds it
 * as a parameter - a mistake this codebase has already paid for.
 */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

function valueJoin(table: FieldValueAlias, fieldId: string): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId)
  )
}

/**
 * The queue, newest bank date first.
 *
 * ⚠️ **Ordered on `postedAt`, not on `createdAt`.** The row's creation time is
 * when the feed happened to fetch it, which for an imported statement is "all
 * at once" and for a backfill is the reverse of the order a person wants to
 * read. The bank's own date is the only ordering that matches the statement
 * sitting beside the screen.
 */
export async function listForReview(
  db: Database,
  filters: ListForReviewFilters
): Promise<Result<BankTransactionRow[], Error>> {
  const { organizationId } = filters
  return guard(
    async () => {
      const ctx = await loadReviewFieldContextWithSuggestions(db, organizationId)
      if (!ctx) return []

      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.bankTransactionDefId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .$dynamic()

      const state = filters.state ?? 'for_review'
      const statusField = ctx.fields.bank_transaction_review_status
      if (state !== 'all' && statusField) {
        const statusValue = alias(schema.FieldValue, 'bt_status_v')
        query = query.innerJoin(
          statusValue,
          and(valueJoin(statusValue, statusField.id), eq(statusValue.optionId, state))
        )
      }

      const accountField = ctx.fields.bank_transaction_bank_account
      if (filters.bankAccountId && accountField) {
        const accountValue = alias(schema.FieldValue, 'bt_account_v')
        query = query.innerJoin(
          accountValue,
          and(
            valueJoin(accountValue, accountField.id),
            eq(accountValue.relatedEntityId, filters.bankAccountId)
          )
        )
      }

      const dateField = ctx.fields.bank_transaction_posted_at
      const dateValue = alias(schema.FieldValue, 'bt_date_v')
      if (dateField) {
        // A LEFT join, always: the ordering needs this column on every row, and
        // an inner join would silently drop a line whose date the feed has not
        // sent yet - which is exactly the line somebody has to go and look at.
        query = query.leftJoin(
          dateValue,
          and(
            valueJoin(dateValue, dateField.id),
            ...(filters.from ? [gte(dateValue.valueDate, `${filters.from}T00:00:00.000Z`)] : []),
            ...(filters.to ? [lte(dateValue.valueDate, `${filters.to}T23:59:59.999Z`)] : [])
          )
        )
        // The bound has to apply to the ROW, not merely to the join, or a line
        // outside the range comes back with a null date instead of being gone.
        if (filters.from || filters.to) where.push(sql`${dateValue.entityId} IS NOT NULL`)
      }

      const amountField = ctx.fields.bank_transaction_amount
      if (amountField && (filters.amountMin != null || filters.amountMax != null)) {
        const amountValue = alias(schema.FieldValue, 'bt_amount_v')
        query = query.innerJoin(
          amountValue,
          and(
            valueJoin(amountValue, amountField.id),
            ...(filters.amountMin != null ? [gte(amountValue.valueNumber, filters.amountMin)] : []),
            ...(filters.amountMax != null ? [lte(amountValue.valueNumber, filters.amountMax)] : [])
          )
        )
      }

      const search = filters.search?.trim()
      if (search) {
        const descriptionField = ctx.fields.bank_transaction_description
        const matchKeyField = ctx.fields.bank_transaction_match_key
        const searchValue = alias(schema.FieldValue, 'bt_search_v')
        const searchable = [descriptionField?.id, matchKeyField?.id].filter(
          (id): id is string => !!id
        )
        if (searchable.length > 0) {
          query = query.innerJoin(
            searchValue,
            and(
              eq(searchValue.entityId, schema.EntityInstance.id),
              eq(searchValue.organizationId, schema.EntityInstance.organizationId),
              inArray(searchValue.fieldId, searchable),
              sql`${searchValue.valueText} ILIKE ${`%${search}%`}`
            )
          )
        }
      }

      const rows = await query
        .where(and(...where))
        .groupBy(schema.EntityInstance.id, schema.EntityInstance.createdAt, dateValue.valueDate)
        .orderBy(desc(dateValue.valueDate), desc(schema.EntityInstance.createdAt))
        .limit(Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
        .offset(filters.offset ?? 0)

      if (rows.length === 0) return []
      return hydrateTransactions(db, organizationId, ctx, rows)
    },
    'Failed to list bank transactions for review',
    { organizationId, state: filters.state }
  )
}

/** One bank line by id, or `null` when it does not exist or belongs elsewhere. */
export async function getBankTransaction(
  db: Database,
  params: { organizationId: string; transactionId: string }
): Promise<Result<BankTransactionRow | null, Error>> {
  const { organizationId, transactionId } = params
  return guard(
    async () => readBankTransaction(db, organizationId, transactionId),
    'Failed to read bank transaction',
    { organizationId, transactionId }
  )
}

/** The unguarded read every write path calls. Throws `NotFoundError`. */
export async function requireBankTransaction(
  db: Database,
  organizationId: string,
  transactionId: string
): Promise<BankTransactionRow> {
  const row = await readBankTransaction(db, organizationId, transactionId)
  if (!row) throw new NotFoundError(`Bank line ${transactionId} was not found`)
  return row
}

async function readBankTransaction(
  db: Database,
  organizationId: string,
  transactionId: string
): Promise<BankTransactionRow | null> {
  const ctx = await loadReviewFieldContextWithSuggestions(db, organizationId)
  if (!ctx) return null
  const [instance] = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, transactionId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.bankTransactionDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!instance) return null
  const [row] = await hydrateTransactions(db, organizationId, ctx, [instance])
  return row ?? null
}

/**
 * What the stat strip renders, for the whole org or for one account.
 *
 * ⚠️ "Unreviewed" is `for_review` PLUS `suggested`, and the two counts are
 * separate on purpose. A suggestion nobody has accepted is still a decision
 * owed, so it belongs in the totals; but the tab badge counts only the lines
 * with nothing proposed, because that is the pile a person is working through.
 *
 * 🛑 **Counted, summed and MIN-ed in SQL, never in memory.** This used to hydrate
 * a page of the queue and do the arithmetic in JavaScript, which silently capped
 * every figure at the page size: on the 2,390-row book this was designed against
 * the badge would have read 500, and `oldestUnreviewedDate` would have been the
 * oldest of the NEWEST 500 - wrong in the reassuring direction, which is the
 * only direction that matters for a number whose whole job is to say how far
 * behind you are.
 */
export async function readQueueStats(
  db: Database,
  params: { organizationId: string; bankAccountId?: string }
): Promise<Result<ReviewQueueStats, Error>> {
  const { organizationId, bankAccountId } = params
  return guard(
    async () => {
      const empty: ReviewQueueStats = {
        forReviewCount: 0,
        unreviewedCount: 0,
        oldestUnreviewedDate: null,
        unreviewedInMinor: 0,
        unreviewedOutMinor: 0,
        coverageFrom: null,
        coverageGapCount: 0,
      }
      const ctx = await loadReviewFieldContext(organizationId)
      if (!ctx) return empty

      const statusField = ctx.fields.bank_transaction_review_status
      const amountField = ctx.fields.bank_transaction_amount
      const dateField = ctx.fields.bank_transaction_posted_at
      if (!statusField || !amountField) return empty

      const statusValue = alias(schema.FieldValue, 'bt_stat_v')
      const amountValue = alias(schema.FieldValue, 'bt_amt_v')
      const dateValue = alias(schema.FieldValue, 'bt_when_v')
      const accountValue = alias(schema.FieldValue, 'bt_acct_v')

      let query = db
        .select({
          status: statusValue.optionId,
          rows: sql<number>`count(*)::int`,
          // `valueNumber` is a DOUBLE holding integer minor units, so the sums
          // are rounded once here rather than divided anywhere.
          inMinor: sql<number>`coalesce(sum(case when ${amountValue.valueNumber} > 0 then ${amountValue.valueNumber} else 0 end), 0)`,
          outMinor: sql<number>`coalesce(sum(case when ${amountValue.valueNumber} < 0 then -${amountValue.valueNumber} else 0 end), 0)`,
          // 🛑 Rendered AT UTC, which is what `toDateKey` does to the string form
          // of the same column. Letting the session timezone decide would move a
          // line dated at UTC midnight to the previous day for half the world.
          oldest: sql<
            string | null
          >`to_char(min(${dateValue.valueDate}) at time zone 'UTC', 'YYYY-MM-DD')`,
        })
        .from(schema.EntityInstance)
        .innerJoin(statusValue, valueJoin(statusValue, statusField.id))
        .leftJoin(amountValue, valueJoin(amountValue, amountField.id))
        .$dynamic()

      if (dateField) query = query.leftJoin(dateValue, valueJoin(dateValue, dateField.id))

      const accountField = ctx.fields.bank_transaction_bank_account
      if (bankAccountId && accountField) {
        query = query.innerJoin(
          accountValue,
          and(
            valueJoin(accountValue, accountField.id),
            eq(accountValue.relatedEntityId, bankAccountId)
          )
        )
      }

      const byStatus = await query
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.bankTransactionDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .groupBy(statusValue.optionId)

      const open = byStatus.filter(
        (bucket) => bucket.status === 'for_review' || bucket.status === 'suggested'
      )
      const oldestKeys = open
        .map((bucket) => bucket.oldest)
        .filter((key): key is string => !!key)
        .sort()

      const stats: ReviewQueueStats = {
        forReviewCount: Number(
          byStatus.find((bucket) => bucket.status === 'for_review')?.rows ?? 0
        ),
        unreviewedCount: open.reduce((sum, bucket) => sum + Number(bucket.rows), 0),
        oldestUnreviewedDate: oldestKeys[0] ?? null,
        unreviewedInMinor: Math.round(
          open.reduce((sum, bucket) => sum + Number(bucket.inMinor), 0)
        ),
        unreviewedOutMinor: Math.round(
          open.reduce((sum, bucket) => sum + Number(bucket.outMinor), 0)
        ),
        coverageFrom: null,
        coverageGapCount: 0,
      }

      // The coverage floor is per ACCOUNT, so it is only answerable when one is
      // selected. Rendering the first account's floor for an "All" view would
      // be a number that is wrong for every other account on the screen.
      if (bankAccountId) {
        const coverage = await readCoverage(db, { organizationId, bankAccountId })
        if (coverage.isOk()) {
          stats.coverageFrom = coverage.value.coverageFrom
          stats.coverageGapCount = coverage.value.gaps.length
        }
      }
      return stats
    },
    'Failed to read bank review stats',
    { organizationId, bankAccountId }
  )
}

/**
 * Everything this bank line might be, best first.
 *
 * 🛑 **Sign-aware.** Money LEAVING the bank can only be a vendor payment, a
 * vendor bill or a refund to a customer; money ARRIVING can only be a bank
 * deposit or a customer charge. Offering the wrong half is not a cosmetic
 * problem: matching a $500 receipt to a $500 payment links two unrelated events
 * and leaves both of the real ones unreconciled forever.
 *
 * Window is ±{@link CANDIDATE_DAY_WINDOW} days and ±1% of the amount. A `search`
 * widens it: the text hit is offered whatever its date, because "anything else"
 * is the escape hatch for the payment that cleared eleven days late.
 */
export async function listMatchCandidates(
  db: Database,
  params: { organizationId: string; transactionId: string; search?: string }
): Promise<Result<MatchCandidate[], Error>> {
  const { organizationId, transactionId } = params
  return guard(
    async () => {
      const line = await requireBankTransaction(db, organizationId, transactionId)
      const dateKey = line.postedAt
      if (!dateKey) return []
      const absMinor = Math.abs(line.amountMinor)
      const flow = bankLineFlow(line.amountMinor)
      const search = params.search?.trim() || undefined

      const candidates = await Promise.all(
        flow === 'out'
          ? [
              readVendorPaymentCandidates(db, organizationId, dateKey, absMinor, search),
              readVendorBillCandidates(db, organizationId, dateKey, absMinor, search),
              readTransactionCandidates(db, organizationId, dateKey, absMinor, 'refund', search),
            ]
          : [
              readBankDepositCandidates(db, organizationId, dateKey, absMinor, search),
              readTransactionCandidates(db, organizationId, dateKey, absMinor, 'charge', search),
            ]
      )

      return candidates
        .flat()
        .sort((a, b) => b.score - a.score || (a.dateKey ?? '').localeCompare(b.dateKey ?? ''))
        .slice(0, 50)
    },
    'Failed to list match candidates',
    { organizationId, transactionId }
  )
}

/**
 * How many `GlPosting`s this bank line has already produced.
 *
 * 🛑 The retry counter behind {@link bankTransactionPeriodKey}'s `attempt`. Read
 * from the LINES' `sourceType`/`sourceId` pair rather than from the row's
 * `glPostingId`, because that column holds only the latest one and a reversed
 * line clears it - so the count would go back to zero and the next code would
 * re-claim the reversed original's period tuple.
 */
export async function countBankTransactionPostings(
  db: Database,
  params: { organizationId: string; transactionId: string }
): Promise<number> {
  const rows = await db
    .selectDistinct({ glPostingId: schema.GlPosting.id })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, params.organizationId),
        eq(schema.GlPostingLine.sourceType, BANK_TRANSACTION_SOURCE_TYPE),
        eq(schema.GlPostingLine.sourceId, params.transactionId)
      )
    )
  return rows.length
}

/** What happened to this line, oldest first. */
export async function readHistory(
  db: Database,
  params: { organizationId: string; transactionId: string }
): Promise<Result<ReviewHistoryEntry[], Error>> {
  const { organizationId, transactionId } = params
  return guard(
    async () => {
      const line = await requireBankTransaction(db, organizationId, transactionId)
      const entries: ReviewHistoryEntry[] = [
        {
          kind: 'arrived',
          label: line.source === 'import' ? 'Imported from a statement' : 'Arrived from the feed',
          detail: line.importBatchId ? `Batch ${line.importBatchId}` : (line.externalId ?? null),
          at: line.createdAt,
        },
      ]

      if (line.reviewStatus !== 'for_review' && line.reviewStatus !== 'suggested') {
        entries.push({
          kind: line.reviewStatus,
          label: REVIEW_HISTORY_LABELS[line.reviewStatus],
          detail: await describeReview(db, organizationId, line),
          at: line.reviewedAt,
        })
      }

      if (line.glPostingId) {
        const [posting] = await db
          .select({
            id: schema.GlPosting.id,
            docNumber: schema.GlPosting.docNumber,
            status: schema.GlPosting.status,
            postedAt: schema.GlPosting.postedAt,
          })
          .from(schema.GlPosting)
          .where(
            and(
              eq(schema.GlPosting.id, line.glPostingId),
              eq(schema.GlPosting.organizationId, organizationId)
            )
          )
          .limit(1)
        if (posting) {
          entries.push({
            kind: 'posted',
            label: posting.status === 'reversed' ? 'Posting reversed' : 'Posted to the ledger',
            detail: posting.docNumber,
            at: posting.postedAt,
            glPostingId: posting.id,
            docNumber: posting.docNumber,
          })
        }
      }

      if (line.ruleId) {
        entries.push({
          kind: 'rule',
          label: 'A rule proposed this treatment',
          detail: line.ruleId,
          at: line.reviewedAt,
        })
      }

      return entries.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
    },
    'Failed to read bank line history',
    { organizationId, transactionId }
  )
}

const REVIEW_HISTORY_LABELS: Record<ReviewStatus, string> = {
  for_review: 'Waiting for review',
  suggested: 'A treatment was suggested',
  matched: 'Matched to a document',
  coded: 'Coded to an account',
  excluded: 'Excluded',
}

/** The sentence under a history row - which document, which account, which reason. */
async function describeReview(
  db: Database,
  organizationId: string,
  line: BankTransactionRow
): Promise<string | null> {
  if (line.reviewStatus === 'excluded') return line.excludeReason
  if (line.reviewStatus === 'coded') return line.glAccountCode
  if (line.reviewStatus === 'matched' && line.matchedRecordId) {
    const [instance] = await db
      .select({ displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.id, line.matchedRecordId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
      .limit(1)
    return instance?.displayName ?? line.matchedRecordId
  }
  return null
}

// ── Candidate sources ───────────────────────────────────────────────────────

/**
 * The `from`/`to` bounds one candidate query narrows on.
 *
 * ⚠️ ISO strings, not `Date`s: `FieldValue.valueDate` is a `timestamp` in
 * `mode: 'string'`, so drizzle compares it as text and handing it a `Date` is a
 * type error rather than a silent coercion. `PaymentTransaction.createdAt` IS a
 * `Date`, which is why {@link windowDates} exists beside this.
 */
function windowBounds(dateKey: string, days = CANDIDATE_DAY_WINDOW) {
  const centre = Date.parse(`${dateKey}T00:00:00.000Z`)
  return {
    from: new Date(centre - days * 86_400_000).toISOString(),
    to: new Date(centre + days * 86_400_000 + 86_399_000).toISOString(),
  }
}

/** {@link windowBounds} as real `Date`s, for the columns that are not strings. */
function windowDates(dateKey: string, days = CANDIDATE_DAY_WINDOW) {
  const bounds = windowBounds(dateKey, days)
  return { from: new Date(bounds.from), to: new Date(bounds.to) }
}

/** Entity-backed candidates: one generic reader, four attribute sets. */
async function readEntityCandidates(params: {
  db: Database
  organizationId: string
  entityType: 'vendor_payment' | 'vendor_bill' | 'bank_deposit'
  recordType: MatchRecordType
  amountAttribute: string
  dateAttribute: string
  linkAttribute: string | null
  secondaryAttribute: string | null
  dateKey: string
  absMinor: number
  search?: string
}): Promise<MatchCandidate[]> {
  const { db, organizationId, entityType, dateKey, absMinor, search } = params
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) return []

  const attributes = [
    params.amountAttribute,
    params.dateAttribute,
    params.linkAttribute,
    params.secondaryAttribute,
  ].filter((attr): attr is string => !!attr)

  const fieldRows = await db
    .select({ id: schema.CustomField.id, attr: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, defId),
        inArray(schema.CustomField.systemAttribute, attributes)
      )
    )
  const fieldIdByAttr = new Map(fieldRows.map((row) => [row.attr ?? '', row.id]))
  const amountFieldId = fieldIdByAttr.get(params.amountAttribute)
  const dateFieldId = fieldIdByAttr.get(params.dateAttribute)
  if (!amountFieldId || !dateFieldId) return []

  const bounds = windowBounds(dateKey)
  const dateValue = alias(schema.FieldValue, 'cand_date_v')

  // The window narrows in SQL; the 1% tolerance is applied in memory over the
  // handful of rows it returns, because a percentage of a bound is not a
  // comparison an index can serve and the day window has already cut the set to
  // a week of one org's documents.
  const windowed = db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .innerJoin(
      dateValue,
      and(
        eq(dateValue.entityId, schema.EntityInstance.id),
        eq(dateValue.organizationId, schema.EntityInstance.organizationId),
        eq(dateValue.fieldId, dateFieldId),
        gte(dateValue.valueDate, bounds.from),
        lte(dateValue.valueDate, bounds.to)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, defId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(200)

  const searched = search
    ? db
        .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, defId),
            isNull(schema.EntityInstance.archivedAt),
            sql`${schema.EntityInstance.displayName} ILIKE ${`%${search}%`}`
          )
        )
        .limit(50)
    : null

  const [inWindow, byText] = await Promise.all([windowed, searched ?? Promise.resolve([])])
  const byId = new Map<string, { id: string; displayName: string | null }>()
  for (const row of [...inWindow, ...byText]) byId.set(row.id, row)
  if (byId.size === 0) return []

  const ids = [...byId.keys()]
  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, ids),
        inArray(schema.FieldValue.fieldId, [...fieldIdByAttr.values()])
      )
    )

  const perInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = perInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      perInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const out: MatchCandidate[] = []
  for (const [id, instance] of byId) {
    const read = (attr: string | null) => {
      if (!attr) return null
      const fieldId = fieldIdByAttr.get(attr)
      return fieldId ? (perInstance.get(id)?.get(fieldId) ?? null) : null
    }
    const amountMinor = Math.round(read(params.amountAttribute)?.valueNumber ?? 0)
    if (amountMinor === 0) continue
    const candidateDate = read(params.dateAttribute)?.valueDate
    const candidateDateKey = candidateDate ? toDateKey(candidateDate) : null

    const matchesWindow =
      isWithinCandidateWindow(dateKey, candidateDateKey) &&
      isWithinAmountTolerance(absMinor, amountMinor)
    const matchesText =
      !!search && (instance.displayName ?? '').toLowerCase().includes(search.toLowerCase())
    if (!matchesWindow && !matchesText) continue

    const link = read(params.linkAttribute)
    out.push({
      recordType: params.recordType,
      recordId: id,
      label: instance.displayName ?? id,
      secondary: read(params.secondaryAttribute)?.valueText ?? null,
      dateKey: candidateDateKey,
      amountMinor: Math.abs(amountMinor),
      score: scoreCandidate({
        bankAbsMinor: absMinor,
        candidateAbsMinor: amountMinor,
        bankDateKey: dateKey,
        candidateDateKey,
      }),
      matchedToBankTransactionId: link?.valueText ?? null,
    })
  }
  return out
}

function readVendorPaymentCandidates(
  db: Database,
  organizationId: string,
  dateKey: string,
  absMinor: number,
  search?: string
): Promise<MatchCandidate[]> {
  return readEntityCandidates({
    db,
    organizationId,
    entityType: 'vendor_payment',
    recordType: 'vendor_payment',
    amountAttribute: 'vendor_payment_amount',
    dateAttribute: 'vendor_payment_paid_at',
    linkAttribute: 'vendor_payment_bank_transaction_id',
    secondaryAttribute: 'vendor_payment_reference',
    dateKey,
    absMinor,
    search,
  })
}

function readVendorBillCandidates(
  db: Database,
  organizationId: string,
  dateKey: string,
  absMinor: number,
  search?: string
): Promise<MatchCandidate[]> {
  return readEntityCandidates({
    db,
    organizationId,
    entityType: 'vendor_bill',
    recordType: 'vendor_bill',
    amountAttribute: 'vendor_bill_total',
    dateAttribute: 'vendor_bill_billed_at',
    // A bill has no bank-line pointer of its own: it is marked `bank_import` by
    // `vendor_bill_paid_source` instead, which is a fact about HOW it was
    // confirmed rather than a link, so nothing here can be already-matched.
    linkAttribute: null,
    secondaryAttribute: 'vendor_bill_number',
    dateKey,
    absMinor,
    search,
  })
}

function readBankDepositCandidates(
  db: Database,
  organizationId: string,
  dateKey: string,
  absMinor: number,
  search?: string
): Promise<MatchCandidate[]> {
  return readEntityCandidates({
    db,
    organizationId,
    entityType: 'bank_deposit',
    recordType: 'bank_deposit',
    amountAttribute: 'bank_deposit_total',
    dateAttribute: 'bank_deposit_date',
    linkAttribute: 'bank_deposit_bank_transaction_id',
    secondaryAttribute: 'bank_deposit_reference',
    dateKey,
    absMinor,
    search,
  })
}

/**
 * `PaymentTransaction` rows, which is where a customer payment actually lives.
 *
 * 🛑 **The transaction table, never the `payment` entity mirror.** `ledger.ts`
 * mints a mirror per allocation and only for a succeeded charge, so refunds get
 * no mirror at all - a matcher reading the entity would silently be unable to
 * match any money going back out, forever.
 */
async function readTransactionCandidates(
  db: Database,
  organizationId: string,
  dateKey: string,
  absMinor: number,
  kind: 'charge' | 'refund',
  search?: string
): Promise<MatchCandidate[]> {
  const bounds = windowDates(dateKey)
  const rows = await db
    .select({
      id: schema.PaymentTransaction.id,
      amount: schema.PaymentTransaction.amount,
      method: schema.PaymentTransaction.method,
      reference: schema.PaymentTransaction.reference,
      createdAt: schema.PaymentTransaction.createdAt,
      // The bank-line pointer is a COLUMN since drizzle 0363; only the
      // user-picked accounting date is still read out of the blob.
      bankTransactionId: schema.PaymentTransaction.bankTransactionId,
      metadata: schema.PaymentTransaction.metadata,
    })
    .from(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.kind, kind),
        inArray(schema.PaymentTransaction.status, ['succeeded', 'disputed']),
        search
          ? or(
              and(
                gte(schema.PaymentTransaction.createdAt, bounds.from),
                lte(schema.PaymentTransaction.createdAt, bounds.to)
              ),
              sql`${schema.PaymentTransaction.reference} ILIKE ${`%${search}%`}`
            )
          : and(
              gte(schema.PaymentTransaction.createdAt, bounds.from),
              lte(schema.PaymentTransaction.createdAt, bounds.to)
            )
      )
    )
    .limit(200)

  const out: MatchCandidate[] = []
  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as { date?: string }
    // The user-picked (possibly backdated) date rides in `metadata.date`; the
    // row's `createdAt` is when it was KEYED, which is not the accounting date.
    // Same rule `postPaymentTransaction` applies when it dates the entry.
    const candidateDateKey =
      metadata.date && /^\d{4}-\d{2}-\d{2}$/.test(metadata.date)
        ? metadata.date
        : toDateKey(row.createdAt)

    const matchesWindow =
      isWithinCandidateWindow(dateKey, candidateDateKey) &&
      isWithinAmountTolerance(absMinor, row.amount)
    const matchesText =
      !!search && (row.reference ?? '').toLowerCase().includes(search.toLowerCase())
    if (!matchesWindow && !matchesText) continue

    out.push({
      recordType: 'payment_transaction',
      recordId: row.id,
      label: `${kind === 'refund' ? 'Refund' : 'Payment'} ${row.reference || row.id.slice(0, 8)}`,
      secondary: row.method,
      dateKey: candidateDateKey,
      amountMinor: Math.abs(row.amount),
      score: scoreCandidate({
        bankAbsMinor: absMinor,
        candidateAbsMinor: row.amount,
        bankDateKey: dateKey,
        candidateDateKey,
      }),
      matchedToBankTransactionId: row.bankTransactionId ?? null,
    })
  }
  return out
}

// ── Hydration ───────────────────────────────────────────────────────────────

/**
 * Turn a page of bank-line ids into full rows with a bounded number of queries:
 * one for the field values, one for the accounts. Never one per row - a queue
 * page is a hundred lines and the real backlog is 2,390.
 */
async function hydrateTransactions(
  db: Database,
  organizationId: string,
  ctx: ReviewFieldContext,
  page: { id: string; createdAt: Date | null }[]
): Promise<BankTransactionRow[]> {
  const ids = page.map((row) => row.id)
  const fieldIds = [
    ...Object.values(ctx.fields)
      .filter((field): field is { id: string } => field != null)
      .map((field) => field.id),
    ...Object.values(ctx.suggestionFields),
  ]

  const values = fieldIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
          valueNumber: schema.FieldValue.valueNumber,
          valueDate: schema.FieldValue.valueDate,
          optionId: schema.FieldValue.optionId,
          relatedEntityId: schema.FieldValue.relatedEntityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, ids),
            inArray(schema.FieldValue.fieldId, fieldIds)
          )
        )
    : []

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const read = (instanceId: string, attr: TransactionAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (byInstance.get(instanceId)?.get(id) ?? null) : null
  }
  const readSuggestion = (instanceId: string, attr: string) => {
    const id = ctx.suggestionFields[attr]
    return id ? (byInstance.get(instanceId)?.get(id) ?? null) : null
  }

  // 🛑 The account's mapped GL code is read THROUGH the account, never copied
  // onto the line. One list read for the whole page - an org has a handful of
  // accounts and a page has a hundred lines.
  const accounts = await listBankAccounts(db, { organizationId })
  const accountById = new Map<string, BankAccountRow>()
  if (accounts.isOk()) for (const account of accounts.value) accountById.set(account.id, account)

  return page.map((row) => {
    const bankAccountId = read(row.id, 'bank_transaction_bank_account')?.relatedEntityId ?? null
    const account = bankAccountId ? accountById.get(bankAccountId) : undefined
    const postedAt = read(row.id, 'bank_transaction_posted_at')?.valueDate
    return {
      id: row.id,
      recordId: toRecordId(ctx.bankTransactionDefId, row.id),
      externalId: read(row.id, 'bank_transaction_external_id')?.valueText ?? null,
      bankAccountId,
      bankAccountName: account?.name ?? null,
      bankAccountCode: account?.glAccountCode ?? null,
      bankAccountConnectorId: account?.connectorId ?? null,
      postedAt: postedAt ? toDateKey(postedAt) : null,
      description: read(row.id, 'bank_transaction_description')?.valueText ?? null,
      // `valueNumber` is a DOUBLE, and this column is already integer minor
      // units by the provider's own convention. Rounded, never divided.
      amountMinor: Math.round(read(row.id, 'bank_transaction_amount')?.valueNumber ?? 0),
      bankStatus: narrowBankStatus(read(row.id, 'bank_transaction_bank_status')?.optionId),
      matchKey: read(row.id, 'bank_transaction_match_key')?.valueText ?? null,
      source: read(row.id, 'bank_transaction_source')?.optionId ?? null,
      importBatchId: read(row.id, 'bank_transaction_import_batch_id')?.valueText ?? null,
      reviewStatus: narrowReviewStatus(read(row.id, 'bank_transaction_review_status')?.optionId),
      glAccountCode: read(row.id, 'bank_transaction_gl_account')?.valueText ?? null,
      matchedRecordId: read(row.id, 'bank_transaction_matched_record_id')?.valueText ?? null,
      matchedRecordType: narrowMatchRecordType(
        read(row.id, 'bank_transaction_matched_record_type')?.valueText
      ),
      excludeReason: read(row.id, 'bank_transaction_exclude_reason')?.valueText ?? null,
      reviewedAt: toDate(read(row.id, 'bank_transaction_reviewed_at')?.valueDate),
      reviewedByUserId: read(row.id, 'bank_transaction_reviewed_by_user_id')?.valueText ?? null,
      glPostingId: read(row.id, 'bank_transaction_gl_posting_id')?.valueText ?? null,
      ruleId: read(row.id, 'bank_transaction_rule_id')?.valueText ?? null,
      suggestedGlAccount:
        readSuggestion(row.id, 'bank_transaction_suggested_gl_account')?.valueText ?? null,
      suggestionReason:
        readSuggestion(row.id, 'bank_transaction_suggestion_reason')?.valueText ?? null,
      createdAt: row.createdAt,
    } satisfies BankTransactionRow
  })
}

/**
 * ⚠️ An unset review status narrows to `for_review`, never to a silent third
 * state. The column is `nullable: false` with `defaultValue: 'for_review'`, so
 * a row without one has skipped the default - which means nobody has looked at
 * it, which is exactly `for_review`.
 */
function narrowReviewStatus(value: string | null | undefined): ReviewStatus {
  switch (value) {
    case 'suggested':
    case 'matched':
    case 'coded':
    case 'excluded':
      return value
    default:
      return 'for_review'
  }
}

/**
 * ⚠️ An unset bank status narrows to `posted`, matching the field's own
 * default. `void` is never inferred: a line is void only because the bank said
 * so, and guessing it would refuse a treatment nobody asked us to refuse.
 */
function narrowBankStatus(value: string | null | undefined): BankStatus {
  return value === 'pending' || value === 'void' ? value : 'posted'
}

/** `FieldValue.valueDate` is a `mode: 'string'` timestamp; the read models hold `Date`. */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function narrowMatchRecordType(value: string | null | undefined): MatchedRecordType | null {
  switch (value) {
    case 'vendor_payment':
    case 'payment_transaction':
    case 'bank_deposit':
    case 'vendor_bill':
    case 'bank_transaction':
    // 🛑 `bank_account` belongs here. It is what a transfer with no counterpart
    // yet stamps, and narrowing it away made every stranded first leg read as
    // `matchedRecordType: null` - which is the one row the late leg has to
    // recognise before it posts the same movement a second time.
    case 'bank_account':
      return value
    default:
      return null
  }
}
