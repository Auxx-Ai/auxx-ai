// packages/lib/src/postings/journal-entries/reads.ts

/**
 * Every READ over the journal-entry draft: the list, the detail, and the field
 * context both halves of the module open with.
 *
 * Reads only. The writes live in `writes.ts`, because a file that both queries
 * and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { readEnvelope } from '@auxx/types/field-value'
import { and, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { NotFoundError, UnprocessableEntityError } from '../../errors'
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
 * Every attribute a {@link JournalEntryRecord} is assembled from.
 *
 * All optional below: entity migration 125 provisions them, and an org that has
 * not run it must read an empty list rather than 500.
 */
const JOURNAL_ENTRY_ATTRIBUTES = [
  'journal_entry_number',
  'journal_entry_date',
  'journal_entry_memo',
  'journal_entry_status',
  'journal_entry_kind',
  'journal_entry_lines',
  'journal_entry_gl_posting_id',
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
 * `status` and `lines` are the two that make the context usable at all: without
 * `status` there is no draft/posted distinction and every write gate reduces to
 * "yes", and without `lines` an entry has no content.
 */
export async function loadJournalEntryFieldContext(
  organizationId: string
): Promise<JournalEntryFieldContext | null> {
  const journalEntryDefId = await getCachedEntityDefId(organizationId, 'journal_entry')
  if (!journalEntryDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...JOURNAL_ENTRY_ATTRIBUTES])) as JournalEntryFields
  if (!fields.journal_entry_status || !fields.journal_entry_lines) return null
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

      if (filters.status && ctx.fields.journal_entry_status) {
        const statusValue = alias(schema.FieldValue, 'je_status_v')
        // 🛑 `draft` is a LEFT join plus a null branch, and the other statuses
        // are not. `toRecord` reads a MISSING status row as `'draft'` - the
        // field carries `defaultValue: 'draft'`, and an entry written before
        // the field existed has no row at all - so an inner join on
        // `optionId = 'draft'` answered a strictly smaller set than the one the
        // reader calls drafts: the JE list would hide an entry the drawer
        // opens, and `?status=draft` would silently lose rows. Nothing else can
        // be absent-by-default, so nothing else needs the branch.
        if (filters.status === 'draft') {
          query = query.leftJoin(
            statusValue,
            valueJoin(statusValue, ctx.fields.journal_entry_status.id)
          )
          where.push(or(eq(statusValue.optionId, 'draft'), isNull(statusValue.optionId)) as SQL)
        } else {
          query = query.innerJoin(
            statusValue,
            and(
              valueJoin(statusValue, ctx.fields.journal_entry_status.id),
              eq(statusValue.optionId, filters.status)
            )
          )
        }
      }

      if (filters.kind && ctx.fields.journal_entry_kind) {
        const kindValue = alias(schema.FieldValue, 'je_kind_v')
        query = query.innerJoin(
          kindValue,
          and(
            valueJoin(kindValue, ctx.fields.journal_entry_kind.id),
            eq(kindValue.optionId, filters.kind)
          )
        )
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
 * Join predicate for "this instance's value of <field>".
 *
 * Takes the alias OBJECT and composes with `eq`, so drizzle emits the table as
 * an identifier. A hand-written `sql` fragment interpolating a table binds it as
 * a parameter instead, which is a mistake this codebase has already paid for.
 */
function valueJoin(
  table: ReturnType<typeof alias<typeof schema.FieldValue, string>>,
  fieldId: string
): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId)
  )
}

/**
 * Turn a page of ids into full rows with ONE additional query.
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
      valueJson: schema.FieldValue.valueJson,
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

  return page.map((row) => toRecord(ctx, row, byInstance.get(row.id)))
}

type ValueRow = {
  valueText: string | null
  valueDate: string | null
  valueJson: unknown
  optionId: string | null
}

function toRecord(
  ctx: JournalEntryFieldContext,
  row: { id: string; createdAt: Date },
  bucket: Map<string, ValueRow> | undefined
): JournalEntryRecord {
  const read = (attribute: JournalEntryAttribute): ValueRow | undefined => {
    const field = ctx.fields[attribute]
    return field ? bucket?.get(field.id) : undefined
  }

  return {
    id: row.id,
    number: read('journal_entry_number')?.valueText ?? null,
    date: toDateKey(read('journal_entry_date')?.valueDate ?? null),
    memo: read('journal_entry_memo')?.valueText ?? null,
    // An entry with no status row is a `draft`: the field carries
    // `defaultValue: 'draft'`, and reading absence as anything else would let a
    // row written before the field existed claim to be posted.
    status: (read('journal_entry_status')?.optionId ?? 'draft') as JournalEntryStatusValue,
    kind: (read('journal_entry_kind')?.optionId ?? 'manual') as JournalEntryKindValue,
    lines: parseLines(read('journal_entry_lines')?.valueJson),
    glPostingId: read('journal_entry_gl_posting_id')?.valueText ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
  }
}

/**
 * Read the stored lines back, discarding anything that is not a usable line.
 *
 * 🛑 Tolerant on READ and strict on WRITE, deliberately. `writes.ts` validates
 * every line before it stores anything, so a malformed row here means the JSON
 * was written by something else or by an older shape - and the honest response
 * is to render what IS readable rather than to throw and make the entry
 * unopenable. `buildManualEntry` refuses the entry a second time before it can
 * post, so a dropped line cannot become a silently unbalanced posting: it
 * becomes a visible imbalance the person can see and fix.
 */
export function parseLines(value: unknown): JournalEntryLine[] {
  // TWO wrappers come off here, and both are load-bearing:
  //
  // 1. The field-value layer's own `{ v, meta }` envelope, which every stored
  //    JSON value carries. `readEnvelope` is its reader and handles the
  //    pre-envelope rows too.
  // 2. Our `{ lines }` object, which exists because a top-level ARRAY is read
  //    as a MULTI-VALUE write and this field is single-value - see
  //    `JournalEntryLinesEnvelope`.
  //
  // A bare array is still accepted, because that is what a hand-written row
  // would most plausibly hold and unwrapping it costs one branch.
  const inner = readEnvelope(value).v ?? value
  const array = Array.isArray(inner)
    ? inner
    : typeof inner === 'object' &&
        inner !== null &&
        Array.isArray((inner as { lines?: unknown }).lines)
      ? (inner as { lines: unknown[] }).lines
      : null
  if (!array) return []
  const lines: JournalEntryLine[] = []
  for (const raw of array) {
    if (typeof raw !== 'object' || raw === null) continue
    const line = raw as Record<string, unknown>
    const accountCode = typeof line.accountCode === 'string' ? line.accountCode : null
    const direction =
      line.direction === 'debit' || line.direction === 'credit' ? line.direction : null
    const amountMinor = typeof line.amountMinor === 'number' ? line.amountMinor : null
    if (!accountCode || !direction || amountMinor === null) continue
    lines.push({
      accountCode,
      direction,
      amountMinor,
      ...(typeof line.memo === 'string' && line.memo ? { memo: line.memo } : {}),
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
function toDateKey(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}
