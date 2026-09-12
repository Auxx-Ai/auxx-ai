// packages/lib/src/data-migrations/migrations/152-credit-memo-gl-posting.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, desc, eq, isNull, ne } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { CREDIT_MEMO_GL_POSTING_ATTRIBUTE } from '../../money/credit-memo-posting/types'
import { CREDIT_MEMO_SOURCE_TYPE } from '../../postings/build-credit-memo-entry'
import type { ResourceField } from '../../resources/registry/field-types'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:152')

const CREDIT_MEMO_ENTITY_TYPE = 'credit_memo'

/**
 * The registry KEY this migration provisions.
 *
 * Named as a key and resolved out of `CREDIT_MEMO_FIELDS` below rather than
 * restated as a literal, so the stored field can never disagree with the one a
 * fresh org is seeded with. A rename in the registry with no rename here throws
 * instead of silently provisioning nothing.
 */
const NEW_FIELD_KEY = 'glPosting'

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/** What migration 152 reports on top of the shared counters. */
export interface Migration152Result extends PerOrgMigrationResult {
  /** Memos that took a stamp from an existing per-memo posting. */
  memosBackfilled: number
}

/** One already-posted memo and the live posting it belongs to. */
interface StampRow {
  creditMemoId: string
  glPostingId: string
}

/**
 * Migration 152: `credit_memo` learns which `GlPosting` it was posted into
 * (`plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §4.1).
 *
 * ## Why the field has to exist
 *
 * A memo's entry is found today by `listPostingsForSource('credit_memo', memoId)`,
 * which reads `GlPostingLine.sourceType` / `sourceId`. The moment memos batch,
 * the entry's lines carry `credit_memo_batch` and the PERIOD KEY instead, so that
 * read returns nothing and `CreditMemoLedgerCard` goes blank for every memo in
 * the batch. The fix is the one `49` already made for fulfillments: read the
 * posting the memo is STAMPED with, not the posting that names it. This field is
 * that stamp.
 *
 * TEXT and not a relationship, because `GlPosting` is a Drizzle table with no
 * `EntityDefinition` to point at - the `gl_posting` EntityRefKind was removed on
 * 2026-08-28 for exactly that reason. `payout_gl_posting_id` and
 * `journal_entry_gl_posting_id` are the precedent; the fulfillment stamp is NOT,
 * because it lives inside the `order_fulfillments` JSON array and a declared
 * field is what keeps §4.3's netting read an indexable join rather than a scan.
 *
 * ## Why a migration and not just the registry edit
 *
 * `CustomField` rows are seeded per org from the resource registry and
 * `ensureCustomFields` is INSERT-only, so a registry edit reaches FRESH orgs and
 * nothing else. Without this, every existing org's `UnifiedCrudHandler` resolves
 * no target for `credit_memo_gl_posting` and drops the write with a log line.
 *
 * ## The backfill, which is the point
 *
 * `ensureCustomFields` writes no values, so the field alone would leave every
 * ALREADY-POSTED memo reading as unposted (§4.2 treats a null stamp as unposted)
 * - the January drive's 14 memos would lose their ledger card AND be offered to
 * the next preview for a second posting. So this also stamps them.
 *
 * One statement finds them: `GlPostingLine` filtered to
 * `sourceType = 'credit_memo'`, joined to its `GlPosting` restricted to a LIVE
 * one (`status <> 'reversed'`), joined to `EntityInstance` restricted to this
 * org's live `credit_memo` records - which is what proves the `sourceId` really
 * is a memo of ours rather than a same-shaped id from somewhere else. A memo
 * carrying more than one live posting takes the NEWEST, matching
 * `listPostingsForSource`'s own ordering, so the stamp names what the card would
 * have shown anyway.
 *
 * The writes are one multi-row INSERT, never a statement per memo: 1,061 channel
 * memos on DemoOrg1 is the backlog this whole brief exists to escape. It is a
 * direct `FieldValue` insert rather than a CRUD call for the reason every other
 * backfill migration is - a migration has no actor to assert against, and going
 * through `bulkUpdate` would fire the credit memo's totals and settlement hooks
 * over a thousand rows to write a value no hook derives.
 *
 * Idempotent both halves over: `ensureCustomFields` skips a field the org holds,
 * and the backfill reads the stamps that already exist and inserts only what is
 * missing. A re-run writes nothing and reports `alreadyUpToDate`.
 *
 * ## Ordering
 *
 * An org with no `credit_memo` def is a SKIP rather than a failure: the seeder
 * creates the def and this field together from the registry.
 */
export const migration152CreditMemoGlPosting = {
  id: '152-credit-memo-gl-posting',
  description:
    'Adds credit_memo_gl_posting to the credit_memo def and backfills it from the existing ' +
    'per-memo postings, so an already-posted memo keeps its ledger card once memos batch and ' +
    'is not offered to the next preview a second time ' +
    '(plans/accounting/tasks/25-batch-posting-and-credit-memos.md §4.1)',

  async up(db: Database, organizationId: string): Promise<Migration152Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const creditMemoDef = existing.entityDefs.get(CREDIT_MEMO_ENTITY_TYPE)
    if (!creditMemoDef) {
      // The org never seeded the `credit_memo` def. A fresh install brings the
      // def and this field along together from the registry.
      return { ...state, alreadyUpToDate: true, memosBackfilled: 0 }
    }

    const field = CREDIT_MEMO_FIELDS[NEW_FIELD_KEY]
    if (!field) {
      throw new Error(
        `credit-memo-fields registry is missing the key "${NEW_FIELD_KEY}" (migration 152)`
      )
    }
    const fields: Record<string, ResourceField> = { [NEW_FIELD_KEY]: field }

    await ensureCustomFields(
      db,
      organizationId,
      CREDIT_MEMO_ENTITY_TYPE,
      creditMemoDef.id,
      fields,
      existing,
      state
    )

    const stampFieldId = await resolveStampFieldId(
      db,
      organizationId,
      creditMemoDef.id,
      existing.fields
    )
    const memosBackfilled = stampFieldId
      ? await backfillStamps(db, organizationId, creditMemoDef.id, stampFieldId)
      : 0

    const changed = state.fieldsCreated > 0 || memosBackfilled > 0

    if (changed) {
      // `ensureCustomFields` bypasses the org cache and `UnifiedCrudHandler`
      // resolves a field's shape from it, so a stale entry would keep dropping
      // every write to the stamp. `perOrgMigration` flushes after the whole
      // batch, but `up()` is also called directly by
      // `scripts/run-entity-migration.ts`, so do it here too (as 151 does).
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 152 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
        memosBackfilled,
      })
    }

    return { ...state, alreadyUpToDate: !changed, memosBackfilled }
  },
  // `satisfies` rather than an annotation: the registry needs a `PerOrgMigration`,
  // but `up()`'s own return type has to survive so a caller (and the test) can
  // read `memosBackfilled`. An annotation would widen it away.
} satisfies PerOrgMigration

/**
 * The `CustomField.id` of the stamp on this org's `credit_memo` def, or `null`.
 *
 * `existing` was loaded before `ensureCustomFields` ran, so a field just created
 * is not in it. Read the row back rather than threading the return map through:
 * it is one indexed lookup and it gives the same answer whether the field was
 * created a second ago or a year ago.
 */
async function resolveStampFieldId(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  knownFields: ReadonlyMap<string, { id: string }>
): Promise<string | null> {
  const known = knownFields.get(fieldKey(entityDefinitionId, CREDIT_MEMO_GL_POSTING_ATTRIBUTE))
  if (known) return known.id

  const [row] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
        eq(schema.CustomField.systemAttribute, CREDIT_MEMO_GL_POSTING_ATTRIBUTE)
      )
    )
    .limit(1)
  return row?.id ?? null
}

/**
 * Every memo in this org that a LIVE posting names, newest posting first.
 *
 * One statement for the whole org. The `EntityInstance` join is not decoration:
 * `GlPostingLine.sourceId` is a bare `text` column with no foreign key, so
 * without it a `sourceType`/`sourceId` pair written by anything else would be
 * stamped onto whatever happened to share the id.
 */
export async function readLivePostedMemos(
  db: Database,
  organizationId: string,
  entityDefinitionId: string
): Promise<StampRow[]> {
  return db
    .selectDistinct({
      creditMemoId: schema.GlPostingLine.sourceId,
      glPostingId: schema.GlPostingLine.glPostingId,
      postedAt: schema.GlPosting.createdAt,
    })
    .from(schema.GlPostingLine)
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId),
        eq(schema.GlPosting.organizationId, organizationId),
        ne(schema.GlPosting.status, 'reversed')
      )
    )
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.GlPostingLine.sourceId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.sourceType, CREDIT_MEMO_SOURCE_TYPE)
      )
    )
    .orderBy(desc(schema.GlPosting.createdAt))
}

/**
 * The memos that need a stamp written: the live-posted ones, minus the ones that
 * already carry a value. Pure - the caller does the reading and the writing.
 *
 * ⚠️ An already-stamped memo is left ALONE rather than rewritten, whatever it
 * points at. Re-running must not be able to move a stamp the poster wrote, and
 * "already has a value" is the only test that holds after the poster starts
 * writing `credit_memo_batch` postings this query cannot see.
 */
export function planStamps(rows: readonly StampRow[], stamped: ReadonlySet<string>): StampRow[] {
  const chosen = new Map<string, string>()
  for (const row of rows) {
    if (stamped.has(row.creditMemoId)) continue
    // `rows` arrives newest posting first, so the first one wins.
    if (!chosen.has(row.creditMemoId)) chosen.set(row.creditMemoId, row.glPostingId)
  }
  return [...chosen].map(([creditMemoId, glPostingId]) => ({ creditMemoId, glPostingId }))
}

/** Write the missing stamps. One SELECT, one INSERT, whatever the memo count. */
async function backfillStamps(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  stampFieldId: string
): Promise<number> {
  const [rows, existingStamps] = await Promise.all([
    readLivePostedMemos(db, organizationId, entityDefinitionId),
    db
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, stampFieldId)
        )
      ),
  ])

  const plan = planStamps(rows, new Set(existingStamps.map((row) => row.entityId)))
  if (plan.length === 0) return 0

  const now = new Date()
  const sortKey = generateKeyBetween(null, null)
  await db.insert(schema.FieldValue).values(
    plan.map((row) => ({
      organizationId,
      entityId: row.creditMemoId,
      entityDefinitionId,
      fieldId: stampFieldId,
      sortKey,
      valueText: row.glPostingId,
      updatedAt: now,
    }))
  )

  return plan.length
}
