// packages/lib/src/accounting/journals/entries/reads.ts

/**
 * Every READ over the journal-entry pointer: the list and the detail. The
 * def-and-field contexts both halves of the module open with live in
 * `fields.ts`.
 *
 * Reads only. The writes live in `writes.ts`, because a file that both queries
 * and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * 🛑 **`status` and `lines` are not `journal_entry` fields any more** (TARGET
 * §1). The record is a pointer; both are read off the linked `GlPosting` row,
 * batched here rather than N+1'd per record.
 *
 * No permission checks anywhere in this file. The router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { NotFoundError, UnprocessableEntityError } from '../../../errors'
import {
  readSystemRecords,
  type SystemRecord,
  systemInstanceColumns,
  systemRecordScope,
  systemValueJoin,
} from '../../../resources/system-records'
import { parsePeriodKey } from '../../ledger/periods/periods'
import { readPostingHeaders } from '../../ledger/reads/read-posting'
import type {
  JournalEntryKindValue,
  JournalEntryLine,
  JournalEntryRecord,
  JournalEntryStatusValue,
  ListJournalEntriesFilters,
} from './client'
import {
  type JournalEntryAttribute,
  type JournalEntryFieldContext,
  loadJournalEntryFieldContext,
  loadRecurrenceIdentityContext,
} from './fields'
import { guard } from './guard'

const DEFAULT_LIMIT = 50

/** One draft, or `null` when it does not exist, is archived, or is another org's. */
export async function getJournalEntry(
  db: Database,
  organizationId: string,
  journalEntryId: string
): Promise<Result<JournalEntryRecord | null, Error>> {
  return guard(
    async () => {
      const ctx = await loadJournalEntryFieldContext(db, organizationId)
      if (!ctx) return null
      const records = await readSystemRecords(db, organizationId, ctx, { ids: [journalEntryId] })
      if (records.length === 0) return null
      const [record] = await hydrate(db, organizationId, ctx, records)
      return record ?? null
    },
    'Failed to read journal entry',
    { organizationId, journalEntryId }
  )
}

/** {@link getJournalEntry}, as the refusal a write path needs. */
export async function requireJournalEntry(
  db: Database,
  organizationId: string,
  journalEntryId: string
): Promise<JournalEntryRecord> {
  const ctx = await loadJournalEntryFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Journal entries are not available until the journal_entry entity is provisioned',
      { organizationId }
    )
  }
  const result = await getJournalEntry(db, organizationId, journalEntryId)
  if (result.isErr()) throw result.error
  if (!result.value) {
    // "This id exists but is not yours" is itself a disclosure, so an entry in
    // another org is indistinguishable from one that never existed.
    throw new NotFoundError('Journal entry not found', { organizationId, journalEntryId })
  }
  return result.value
}

/**
 * List drafts and posted entries, newest first.
 *
 * Ordered by `createdAt` rather than by the accounting `date`, for the reason
 * `listBuilds` gives: a draft somebody has not dated yet has no date at all,
 * and ordering on it sorts every unfinished entry to one end of the list -
 * which is the half a bookkeeper is looking at.
 *
 * Every filter is applied IN SQL, so a caller asking for page two gets page two
 * of the filtered set (`docs/lib-module-guide.md` §6).
 *
 * ⚠️ `periodKey` filters on the entry's own `date`, month by month, NOT on the
 * posting's `periodKey` - which for a `manual_journal` is the entry NUMBER.
 * Filtering on the posting key would answer "which entries are numbered
 * 2026-08", which is nothing.
 */
export async function listJournalEntries(
  db: Database,
  organizationId: string,
  filters: ListJournalEntriesFilters = {}
): Promise<Result<JournalEntryRecord[], Error>> {
  return guard(
    async () => {
      const ctx = await loadJournalEntryFieldContext(db, organizationId)
      if (!ctx) return []

      const where: SQL[] = [systemRecordScope(organizationId, ctx.defId)]

      let query = db.select(systemInstanceColumns).from(schema.EntityInstance).$dynamic()

      // 🛑 Every draft carries a posting now (TARGET §1), so this is a plain
      // INNER join through the pointer to `GlPosting.status` - there is no
      // longer a default-value fallback to branch on, unlike `kind` below.
      if (filters.status && ctx.fields.journal_entry_gl_posting_id) {
        const postingIdValue = alias(schema.FieldValue, 'je_posting_v')
        const posting = alias(schema.GlPosting, 'je_posting')
        query = query
          .innerJoin(
            postingIdValue,
            systemValueJoin(postingIdValue, ctx.fields.journal_entry_gl_posting_id.id)
          )
          .innerJoin(
            posting,
            and(
              eq(posting.id, postingIdValue.valueText),
              eq(posting.organizationId, organizationId)
            )
          )
        where.push(eq(posting.status, filters.status))
      }

      if (filters.kinds?.length && ctx.fields.journal_entry_kind) {
        const kindValue = alias(schema.FieldValue, 'je_kind_v')
        // 🛑 `manual` needs a LEFT-join-plus-null branch: the field carries
        // `defaultValue: 'manual'` and `toRecord` reads a MISSING kind row as
        // `manual`, so an inner join would hide an entry the drawer opens.
        // Every other kind is written explicitly at create time.
        if (filters.kinds.includes('manual')) {
          query = query.leftJoin(
            kindValue,
            systemValueJoin(kindValue, ctx.fields.journal_entry_kind.id)
          )
          where.push(
            or(inArray(kindValue.optionId, filters.kinds), isNull(kindValue.optionId)) as SQL
          )
        } else {
          query = query.innerJoin(
            kindValue,
            and(
              systemValueJoin(kindValue, ctx.fields.journal_entry_kind.id),
              inArray(kindValue.optionId, filters.kinds)
            )
          )
        }
      }

      if (filters.periodKey && ctx.fields.journal_entry_date) {
        // A half-open range on the stored timestamp, not a string prefix.
        // `valueDate` is a `timestamptz`, so `LIKE '2026-08%'` would depend on
        // the driver's rendering and would miss every row written in another
        // offset.
        //
        // ⚠️ The bounds are UTC midnights, and that is correct HERE and only
        // here: `writes.ts` stores the accounting date as midnight UTC because
        // it is a date rather than an instant, so this filter is exact against
        // what was written. It is a LIST convenience, not the period a posting
        // lands in - `postEntry` derives that from `txnDate` through
        // `periods.ts` in `accounting.bookTimeZone`, which is the only place
        // the wall-clock rule applies.
        const bounds = monthBoundsUtc(filters.periodKey)
        const dateValue = alias(schema.FieldValue, 'je_date_v')
        query = query.innerJoin(
          dateValue,
          and(
            systemValueJoin(dateValue, ctx.fields.journal_entry_date.id),
            gte(dateValue.valueDate, bounds.start),
            lt(dateValue.valueDate, bounds.end)
          )
        )
      }

      const rows = await query
        .where(and(...where))
        .orderBy(desc(schema.EntityInstance.createdAt))
        .limit(filters.limit ?? DEFAULT_LIMIT)
        .offset(filters.offset ?? 0)

      if (rows.length === 0) return []
      const records = await readSystemRecords(db, organizationId, ctx, { instances: rows })
      return hydrate(db, organizationId, ctx, records)
    },
    'Failed to list journal entries',
    { organizationId, filters }
  )
}

/** What a generated entry says it is: the rule that made it and the slot it fills. */
export interface RecurrenceIdentity {
  recurrenceRuleId: string
  occurrenceDate: string
}

/**
 * The recurrence identity of each of `journalEntryIds` that has one.
 *
 * 🛑 **This is how the poster tells a converged re-post from a HASH
 * COLLISION**, and the indirection through the record is deliberate. A
 * `recurring` posting's `periodKey` is a six-base-36-digit fold of
 * `<ruleId>:<occurrenceDate>` (`period-key.ts`), so two DIFFERENT occurrences
 * can mint one key; the loser gets `already_posted`, a success status, and its
 * entry never reaches the books.
 *
 * The obvious check - "does the winning posting's line `sourceId` equal my
 * record id" - is WRONG here and would fire on the ordinary case. The record
 * layer is check-then-write (§0.10: `FieldValue` has one unique index and it is
 * not `(ruleId, occurrenceDate)`), so a race can leave two DRAFTS of one
 * occurrence with two different record ids and one shared key. That is a
 * convergence, not a collision. What tells them apart is whether the winner
 * fills the same SLOT, which is what this reads.
 *
 * An id with no identity rows is simply absent from the map - a hand-authored
 * entry that somehow shares the key is a collision, and the caller treats a
 * missing entry as "not mine".
 */
export async function readRecurrenceIdentities(
  db: Database,
  organizationId: string,
  journalEntryIds: string[]
): Promise<Map<string, RecurrenceIdentity>> {
  const identities = new Map<string, RecurrenceIdentity>()
  if (journalEntryIds.length === 0) return identities

  const ctx = await loadRecurrenceIdentityContext(db, organizationId)
  if (!ctx) return identities

  // `includeArchived`: a discarded entry's identity still answers "was this key
  // mine", which is the only question the poster asks here.
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: journalEntryIds,
    includeArchived: true,
  })

  // Only a COMPLETE pair is an identity. Half of one names no slot, so it can
  // neither confirm nor deny ownership of the key.
  for (const record of records) {
    const recurrenceRuleId = record.text('journal_entry_recurrence_rule_id')?.trim()
    const occurrenceDate = record.text('journal_entry_occurrence_date')?.trim()
    if (recurrenceRuleId && occurrenceDate)
      identities.set(record.id, { recurrenceRuleId, occurrenceDate })
  }
  return identities
}

/**
 * The half-open `[start, end)` UTC instants of one accounting month.
 *
 * `parsePeriodKey` owns the keyspace and throws `BadRequestError` on anything
 * that is not `'2026-08'`, so a malformed filter refuses rather than silently
 * matching everything.
 */
function monthBoundsUtc(periodKey: string): { start: string; end: string } {
  const { year, month } = parsePeriodKey(periodKey)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Turn a page of read records into full rows with ONE additional query: the
 * linked postings that carry status and lines, batched by
 * `journal_entry_gl_posting_id`.
 *
 * The alternative - a join per attribute on the paging query - multiplies the
 * row count and makes `LIMIT` mean something other than "this many entries".
 */
async function hydrate(
  db: Database,
  organizationId: string,
  ctx: JournalEntryFieldContext,
  page: SystemRecord<JournalEntryAttribute>[]
): Promise<JournalEntryRecord[]> {
  const glPostingIds = new Set<string>()
  for (const record of page) {
    const raw = record.text('journal_entry_gl_posting_id')
    if (raw) glPostingIds.add(raw)
  }
  const postingById = await readLinkedPostings(db, organizationId, [...glPostingIds])

  return page.map((record) => toRecord(record, postingById))
}

/** What `toRecord` needs off the linked `GlPosting` row: its status and its lines. */
interface LinkedPosting {
  status: JournalEntryStatusValue
  built: unknown
}

/** The linked postings behind a page of records, batched by id. */
async function readLinkedPostings(
  db: Database,
  organizationId: string,
  glPostingIds: string[]
): Promise<Map<string, LinkedPosting>> {
  const headers = await readPostingHeaders(db, organizationId, glPostingIds)
  const byId = new Map<string, LinkedPosting>()
  for (const [id, header] of headers) {
    byId.set(id, { status: header.status as JournalEntryStatusValue, built: header.built })
  }
  return byId
}

function toRecord(
  record: SystemRecord<JournalEntryAttribute>,
  postingById: Map<string, LinkedPosting>
): JournalEntryRecord {
  const glPostingId = record.text('journal_entry_gl_posting_id')
  const posting = glPostingId ? postingById.get(glPostingId) : undefined

  return {
    id: record.id,
    number: record.text('journal_entry_number'),
    date: parseDateKeyOrNull(record.date('journal_entry_date')),
    memo: record.text('journal_entry_memo'),
    // A record whose companion draft is missing (the second half of
    // `createJournalEntry` never ran) reads as `draft` - there is nothing else
    // it could be, since only a posting can move it further.
    status: posting?.status ?? 'draft',
    kind: (record.option('journal_entry_kind') ?? 'manual') as JournalEntryKindValue,
    lines: linesFromBuilt(posting?.built),
    glPostingId,
    recurrenceRuleId: record.text('journal_entry_recurrence_rule_id'),
    occurrenceDate: record.text('journal_entry_occurrence_date'),
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : null,
  }
}

/**
 * Read a draft's lines off its posting's `resolvedLines`, discarding anything
 * that is not a usable line.
 *
 * 🛑 Tolerant on READ, deliberately - the same rule the old `journal_entry_lines`
 * parser followed. A malformed envelope means the row was written by something
 * else, and the honest response is to render what IS readable. `buildManualEntry`
 * refuses the entry a second time before it can post, so a dropped line cannot
 * become a silently unbalanced posting.
 */
export function linesFromBuilt(built: unknown): JournalEntryLine[] {
  if (typeof built !== 'object' || built === null) return []
  const resolvedLines = (built as { resolvedLines?: unknown }).resolvedLines
  if (!Array.isArray(resolvedLines)) return []

  const lines: JournalEntryLine[] = []
  for (const raw of resolvedLines) {
    if (typeof raw !== 'object' || raw === null) continue
    const line = raw as Record<string, unknown>
    const glAccountId =
      typeof line.glAccountId === 'string' && line.glAccountId.trim().length > 0
        ? line.glAccountId
        : null
    const direction =
      line.direction === 'debit' || line.direction === 'credit' ? line.direction : null
    const amountMinor = typeof line.amount === 'number' ? line.amount : null
    if (!glAccountId || !direction || amountMinor === null) continue
    const counterpartyType =
      line.counterpartyType === 'customer' || line.counterpartyType === 'vendor'
        ? line.counterpartyType
        : null
    const counterpartyId =
      typeof line.counterpartyId === 'string' && line.counterpartyId.trim().length > 0
        ? line.counterpartyId
        : null
    lines.push({
      glAccountId,
      direction,
      amountMinor,
      ...(typeof line.memo === 'string' && line.memo ? { memo: line.memo } : {}),
      ...(counterpartyType && counterpartyId ? { counterpartyType, counterpartyId } : {}),
    })
  }
  return lines
}

/**
 * Keep the accounting date as `YYYY-MM-DD`.
 *
 * `FieldValue.valueDate` is a `timestamptz` in string mode, so the stored value
 * is an instant. The accounting date is not: giving it a time and a zone on its
 * way to a browser renders a month-end entry as the previous month for any
 * reader west of UTC, which is the one presentation bug a bookkeeper cannot
 * argue with. `writes.ts` stores midnight UTC, so slicing is exact.
 */
function parseDateKeyOrNull(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}
