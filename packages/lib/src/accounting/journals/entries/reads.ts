// packages/lib/src/accounting/journals/entries/reads.ts

/**
 * Every READ over the journal-entry document: the list and the detail. Lines are
 * the `journal_entry_line` children; the status is `draft` until Post stamps
 * `journal_entry_gl_posting_id`, then that posting's. No permission checks
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
  loadJournalEntryFieldContext,
  loadJournalEntryLineFieldContext,
  loadRecurrenceIdentityContext,
} from './fields'
import { guard } from './guard'

const DEFAULT_LIMIT = 50

/** One entry, or `null` when it does not exist, is archived, or is another org's. */
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
      const [record] = await hydrate(db, organizationId, records)
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
 * List entries newest first (by `createdAt`), every filter applied IN SQL.
 * `periodKey` filters on the entry's own `date` by month, never on the posting's
 * `periodKey`, which for a `manual_journal` is the entry number.
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

      // `draft` is the absence of a live pointer: no value, or one naming a posting that is gone.
      if (filters.status && ctx.fields.journal_entry_gl_posting_id) {
        const postingIdValue = alias(schema.FieldValue, 'je_posting_v')
        const posting = alias(schema.GlPosting, 'je_posting')
        query = query
          .leftJoin(
            postingIdValue,
            systemValueJoin(postingIdValue, ctx.fields.journal_entry_gl_posting_id.id)
          )
          .leftJoin(
            posting,
            and(
              eq(posting.id, postingIdValue.valueText),
              eq(posting.organizationId, organizationId)
            )
          )
        where.push(
          filters.status === 'draft' ? isNull(posting.id) : eq(posting.status, filters.status)
        )
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
      return hydrate(db, organizationId, records)
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
 * Turn a page of records into full rows with two batched reads: the stamped
 * postings (for status) and the line children. Never a join on the paging query,
 * which would make `LIMIT` count something other than entries.
 */
async function hydrate(
  db: Database,
  organizationId: string,
  page: SystemRecord<JournalEntryAttribute>[]
): Promise<JournalEntryRecord[]> {
  const glPostingIds = page
    .map((record) => record.text('journal_entry_gl_posting_id'))
    .filter((id): id is string => !!id)
  const [headers, linesByEntry] = await Promise.all([
    readPostingHeaders(db, organizationId, glPostingIds),
    readJournalEntryLines(
      db,
      organizationId,
      page.map((record) => record.id)
    ),
  ])

  return page.map((record) => {
    const glPostingId = record.text('journal_entry_gl_posting_id')
    const posting = glPostingId ? headers.get(glPostingId) : undefined
    return {
      id: record.id,
      number: record.text('journal_entry_number'),
      date: parseDateKeyOrNull(record.date('journal_entry_date')),
      memo: record.text('journal_entry_memo'),
      // A pointer naming a posting that is gone (a ledger reset) reads as unposted.
      status: (posting?.status ?? 'draft') as JournalEntryStatusValue,
      kind: (record.option('journal_entry_kind') ?? 'manual') as JournalEntryKindValue,
      lines: linesByEntry.get(record.id) ?? [],
      glPostingId,
      recurrenceRuleId: record.text('journal_entry_recurrence_rule_id'),
      occurrenceDate: record.text('journal_entry_occurrence_date'),
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : null,
    }
  })
}

/**
 * The `journal_entry_line` children of each entry, in sort order, keyed by entry
 * id. Tolerant on read: a row missing its account or amount still renders, and
 * `buildManualEntry` refuses it by row number at Post.
 */
export async function readJournalEntryLines(
  db: Database,
  organizationId: string,
  journalEntryIds: readonly string[]
): Promise<Map<string, JournalEntryLine[]>> {
  const byEntry = new Map<string, JournalEntryLine[]>()
  if (journalEntryIds.length === 0) return byEntry
  const ctx = await loadJournalEntryLineFieldContext(db, organizationId)
  if (!ctx) return byEntry

  const rows = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'journal_entry_line_journal_entry', in: journalEntryIds },
  })
  const ranked = rows
    .map((row) => ({ row, sortKey: row.number('journal_entry_line_sort_order') ?? 0 }))
    .sort((a, b) => a.sortKey - b.sortKey)

  for (const { row } of ranked) {
    const entryId = row.related('journal_entry_line_journal_entry')
    if (!entryId) continue
    const counterpartyType = row.option('journal_entry_line_counterparty_type')
    const counterpartyId = row.text('journal_entry_line_counterparty')
    const memo = row.text('journal_entry_line_memo')
    const line: JournalEntryLine = {
      id: row.id,
      glAccountId: row.text('journal_entry_line_gl_account') ?? '',
      direction: row.option('journal_entry_line_side') === 'credit' ? 'credit' : 'debit',
      amountMinor: row.number('journal_entry_line_amount') ?? 0,
      ...(memo ? { memo } : {}),
      ...((counterpartyType === 'customer' || counterpartyType === 'vendor') && counterpartyId
        ? { counterpartyType, counterpartyId }
        : {}),
    }
    const list = byEntry.get(entryId)
    if (list) list.push(line)
    else byEntry.set(entryId, [line])
  }
  return byEntry
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
