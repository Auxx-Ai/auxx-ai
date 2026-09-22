// packages/lib/src/data-migrations/migrations/187-journal-entry-line.ts

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { JOURNAL_ENTRY_FIELDS } from '../../resources/registry/resources/journal-entry-fields'
import { JOURNAL_ENTRY_LINE_FIELDS } from '../../resources/registry/resources/journal-entry-line-fields'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:187')

const JOURNAL_ENTRY = 'journal_entry'
const JOURNAL_ENTRY_LINE = 'journal_entry_line'
const LINES_ATTRIBUTE = 'journal_entry_lines'

/** Both halves of the one edge this migration adds; an unlinked half is checked, not trusted (the 135 lesson). */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  {
    owning: `${JOURNAL_ENTRY}:${JOURNAL_ENTRY_FIELDS.lines?.id}`,
    inverse: 'journal_entry_line:journalEntry',
  },
  {
    owning: `${JOURNAL_ENTRY_LINE}:${JOURNAL_ENTRY_LINE_FIELDS.journalEntry?.id}`,
    inverse: 'journal_entry:lines',
  },
]

const CACHE_KEYS = ['entityDefs', 'entityDefSlugs', 'customFields', 'resources'] as const

export interface Migration187Result extends PerOrgMigrationResult {
  /** Whether a stale non-relationship `journal_entry_lines` field (migration 125's JSON) was dropped. */
  staleLinesFieldDropped: boolean
}

/**
 * Migration 187: the `journal_entry_line` child def, its fields, and
 * `journal_entry.lines` as its cascading has_many (91 D5) - the manual journal
 * becomes a document like a bill.
 *
 * No backfill: a manual journal's lines lived on a draft `GlPosting`, and the 91
 * schema migration discards every draft (91 §8.10). Idempotent: INSERT-only
 * helpers, and the stale-field drop is gated on the stored type.
 */
export const migration187JournalEntryLine: PerOrgMigration = {
  id: '187-journal-entry-line',
  description:
    'Adds the hidden journal_entry_line def with its fields and journal_entry.lines as a ' +
    'cascading has_many - the manual journal holds its own lines, like a bill (91 D5). ' +
    'Drops a stale JSON journal_entry_lines field first. No backfill',

  async up(db: Database, organizationId: string): Promise<Migration187Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    let existing = await loadExistingState(db, organizationId)

    const journalDef = existing.entityDefs.get(JOURNAL_ENTRY)
    if (!journalDef) return { ...state, alreadyUpToDate: true, staleLinesFieldDropped: false }

    const staleLinesFieldDropped = await dropStaleLinesField(db, organizationId, journalDef.id)
    if (staleLinesFieldDropped) existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === JOURNAL_ENTRY_LINE),
      existing,
      state
    )
    entityDefIds.set(JOURNAL_ENTRY, journalDef.id)
    const lineDefId = entityDefIds.get(JOURNAL_ENTRY_LINE)
    if (!lineDefId) throw new Error('Could not create the journal_entry_line def (migration 187)')

    const linesField = JOURNAL_ENTRY_FIELDS.lines as ResourceField | undefined
    if (!linesField) throw new Error('journal-entry-fields registry has no `lines` (migration 187)')

    // One map across both defs: `linkNewRelationships` resolves an inverse out of it.
    const fieldMap = new Map([
      ...(await ensureCustomFields(
        db,
        organizationId,
        JOURNAL_ENTRY_LINE,
        lineDefId,
        JOURNAL_ENTRY_LINE_FIELDS as Record<string, ResourceField>,
        existing,
        state
      )),
      ...(await ensureCustomFields(
        db,
        organizationId,
        JOURNAL_ENTRY,
        journalDef.id,
        { lines: linesField },
        existing,
        state
      )),
    ])

    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)
    await linkDisplayFields(db, [JOURNAL_ENTRY_LINE], entityDefIds, fieldMap)

    const changed =
      state.entityDefsCreated > 0 ||
      state.fieldsCreated > 0 ||
      state.relationshipsLinked > 0 ||
      staleLinesFieldDropped
    if (changed) {
      // The writes bypass the org cache, and `UnifiedCrudHandler` resolves defs and fields from it.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 187 applied', { organizationId, ...state, staleLinesFieldDropped })
    }

    return { ...state, alreadyUpToDate: !changed, staleLinesFieldDropped }
  },
}

/**
 * Delete a `journal_entry_lines` field that is not a RELATIONSHIP - migration
 * 125's JSON lines, which `ensureCustomFields` would otherwise see under the same
 * attribute and never replace. Its values cascade with it; nothing reads them.
 */
async function dropStaleLinesField(
  db: Database,
  organizationId: string,
  journalDefId: string
): Promise<boolean> {
  const [field] = await db
    .select({ id: schema.CustomField.id, type: schema.CustomField.type })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, journalDefId),
        eq(schema.CustomField.systemAttribute, LINES_ATTRIBUTE)
      )
    )
    .limit(1)
  if (!field || field.type === FieldType.RELATIONSHIP) return false

  await db.delete(schema.CustomField).where(eq(schema.CustomField.id, field.id))
  logger.info('Dropped stale journal_entry_lines field', {
    organizationId,
    fieldId: field.id,
    previousType: field.type,
  })
  return true
}

/** Fail loudly when a relationship half was created but never linked. */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) throw new Error(`migration 187 could not resolve the field ${owning}`)
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(`migration 187 created ${owning} but could not link it to ${inverse}`)
    }
  }
}
