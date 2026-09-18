// packages/lib/src/postings/journal-entries/reads.ts

/**
 * Every READ over the journal-entry pointer: the list, the detail, and the
 * field context both halves of the module open with.
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
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { NotFoundError, UnprocessableEntityError } from '../../errors'
import { valueJoin } from '../../field-values/read-kit'
import { parsePeriodKey } from '../periods'
import type {
  JournalEntryKindValue,
  JournalEntryLine,
  JournalEntryRecord,
  JournalEntryStatusValue,
  ListJournalEntriesFilters,
} from './client'
import { guard } from './guard'

/**
 * Every attribute a {@link JournalEntryRecord} is assembled from, that is
 * still a `journal_entry` field. `status` and `lines` come off the linked
 * `GlPosting` instead - see the file header.
 *
 * All optional below: entity migration 125 provisions them, and an org that has
 * not run it must read an empty list rather than 500.
 */
const JOURNAL_ENTRY_ATTRIBUTES = [
  'journal_entry_number',
  'journal_entry_date',
  'journal_entry_memo',
  'journal_entry_kind',
  'journal_entry_gl_posting_id',
  'journal_entry_recurrence_rule_id',
  'journal_entry_occurrence_date',
] as const

type JournalEntryAttribute = (typeof JOURNAL_ENTRY_ATTRIBUTES)[number]

/** `systemAttribute` -> the materialised `CustomField`, or `null`. */
type JournalEntryFields = Record<JournalEntryAttribute, { id: string } | null>

/** The resolved ids every journal-entry read and write needs. */
export interface JournalEntryFieldContext {
  journalEntryDefId: string
  fields: JournalEntryFields
}

const DEFAULT_LIMIT = 50

/**
 * Resolve the `journal_entry` def and its fields, or `null` when the org has
 * not run migration 125.
 *
 * `null` rather than a throw so a list surface on an unmigrated org renders
 * empty. The WRITE paths use {@link requireJournalEntryFieldContext} instead,
 * because a write that silently did nothing would be worse than a refusal.
 *
 * `journal_entry_gl_posting_id` is the one that makes the context usable at
 * all now: without it there is no pointer to the posting that carries the
 * entry's status and lines.
 */
export async function loadJournalEntryFieldContext(
  organizationId: string
): Promise<JournalEntryFieldContext | null> {
  const journalEntryDefId = await getCachedEntityDefId(organizationId, 'journal_entry')
  if (!journalEntryDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...JOURNAL_ENTRY_ATTRIBUTES])) as JournalEntryFields
  if (!fields.journal_entry_gl_posting_id || !fields.journal_entry_date) return null
  return { journalEntryDefId, fields }
}

/** {@link loadJournalEntryFieldContext}, as the refusal a write path needs. */
export async function requireJournalEntryFieldContext(
  organizationId: string
): Promise<JournalEntryFieldContext> {
  const ctx = await loadJournalEntryFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Journal entries are not available until the journal_entry entity and its fields are ' +
        'provisioned. Run the entity migrations.',
      { organizationId }
    )
  }
  return ctx
}

/** One draft, or `null` when it does not exist, is archived, or is another org's. */
export async function getJournalEntry(
  db: Database,
  organizationId: string,
  journalEntryId: string
): Promise<Result<JournalEntryRecord | null, Error>> {
  return guard(
    async () => {
      const ctx = await loadJournalEntryFieldContext(organizationId)
      if (!ctx) return null

      const [instance] = await db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, journalEntryId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.journalEntryDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .limit(1)

      if (!instance) return null
      const [record] = await hydrate(db, organizationId, ctx, [instance])
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
  const ctx = await loadJournalEntryFieldContext(organizationId)
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
      const ctx = await loadJournalEntryFieldContext(organizationId)
      if (!ctx) return []

      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.journalEntryDefId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .$dynamic()

      // 🛑 Every draft carries a posting now (TARGET §1), so this is a plain
      // INNER join through the pointer to `GlPosting.status` - there is no
      // longer a default-value fallback to branch on, unlike `kind` below.
      if (filters.status && ctx.fields.journal_entry_gl_posting_id) {
        const postingIdValue = alias(schema.FieldValue, 'je_posting_v')
        const posting = alias(schema.GlPosting, 'je_posting')
        query = query
          .innerJoin(
            postingIdValue,
            valueJoin(postingIdValue, ctx.fields.journal_entry_gl_posting_id.id)
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
          query = query.leftJoin(kindValue, valueJoin(kindValue, ctx.fields.journal_entry_kind.id))
          where.push(
            or(inArray(kindValue.optionId, filters.kinds), isNull(kindValue.optionId)) as SQL
          )
        } else {
          query = query.innerJoin(
            kindValue,
            and(
              valueJoin(kindValue, ctx.fields.journal_entry_kind.id),
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
            valueJoin(dateValue, ctx.fields.journal_entry_date.id),
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
      return hydrate(db, organizationId, ctx, rows)
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

  const ctx = await loadJournalEntryFieldContext(organizationId)
  const ruleField = ctx?.fields.journal_entry_recurrence_rule_id
  const slotField = ctx?.fields.journal_entry_occurrence_date
  if (!ruleField || !slotField) return identities

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, journalEntryIds),
        inArray(schema.FieldValue.fieldId, [ruleField.id, slotField.id])
      )
    )

  const partial = new Map<string, Partial<RecurrenceIdentity>>()
  for (const row of rows) {
    const value = row.valueText?.trim()
    if (!value) continue
    const bucket = partial.get(row.entityId) ?? {}
    if (row.fieldId === ruleField.id) bucket.recurrenceRuleId = value
    else bucket.occurrenceDate = value
    partial.set(row.entityId, bucket)
  }

  // Only a COMPLETE pair is an identity. Half of one names no slot, so it can
  // neither confirm nor deny ownership of the key.
  for (const [entityId, bucket] of partial) {
    if (bucket.recurrenceRuleId && bucket.occurrenceDate) {
      identities.set(entityId, {
        recurrenceRuleId: bucket.recurrenceRuleId,
        occurrenceDate: bucket.occurrenceDate,
      })
    }
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
 * Turn a page of ids into full rows with TWO additional queries: the
 * `journal_entry` field values, and - batched by `journal_entry_gl_posting_id`
 * - the linked postings that carry status and lines.
 *
 * The alternative - a join per attribute on the paging query - multiplies the
 * row count and makes `LIMIT` mean something other than "this many entries".
 */
async function hydrate(
  db: Database,
  organizationId: string,
  ctx: JournalEntryFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<JournalEntryRecord[]> {
  const ids = page.map((row) => row.id)
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, ids),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const postingField = ctx.fields.journal_entry_gl_posting_id
  const glPostingIds = new Set<string>()
  if (postingField) {
    for (const bucket of byInstance.values()) {
      const raw = bucket.get(postingField.id)?.valueText
      if (raw) glPostingIds.add(raw)
    }
  }
  const postingById = await readLinkedPostings(db, organizationId, [...glPostingIds])

  return page.map((row) => toRecord(ctx, row, byInstance.get(row.id), postingById))
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
  const byId = new Map<string, LinkedPosting>()
  if (glPostingIds.length === 0) return byId

  const rows = await db
    .select({
      id: schema.GlPosting.id,
      status: schema.GlPosting.status,
      built: schema.GlPosting.built,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        inArray(schema.GlPosting.id, glPostingIds)
      )
    )

  for (const row of rows) {
    byId.set(row.id, { status: row.status as JournalEntryStatusValue, built: row.built })
  }
  return byId
}

type ValueRow = {
  valueText: string | null
  valueDate: string | null
  optionId: string | null
}

function toRecord(
  ctx: JournalEntryFieldContext,
  row: { id: string; createdAt: Date },
  bucket: Map<string, ValueRow> | undefined,
  postingById: Map<string, LinkedPosting>
): JournalEntryRecord {
  const read = (attribute: JournalEntryAttribute): ValueRow | undefined => {
    const field = ctx.fields[attribute]
    return field ? bucket?.get(field.id) : undefined
  }

  const glPostingId = read('journal_entry_gl_posting_id')?.valueText ?? null
  const posting = glPostingId ? postingById.get(glPostingId) : undefined

  return {
    id: row.id,
    number: read('journal_entry_number')?.valueText ?? null,
    date: parseDateKeyOrNull(read('journal_entry_date')?.valueDate ?? null),
    memo: read('journal_entry_memo')?.valueText ?? null,
    // A record whose companion draft is missing (the second half of
    // `createJournalEntry` never ran) reads as `draft` - there is nothing else
    // it could be, since only a posting can move it further.
    status: posting?.status ?? 'draft',
    kind: (read('journal_entry_kind')?.optionId ?? 'manual') as JournalEntryKindValue,
    lines: linesFromBuilt(posting?.built),
    glPostingId,
    recurrenceRuleId: read('journal_entry_recurrence_rule_id')?.valueText ?? null,
    occurrenceDate: read('journal_entry_occurrence_date')?.valueText ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
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
