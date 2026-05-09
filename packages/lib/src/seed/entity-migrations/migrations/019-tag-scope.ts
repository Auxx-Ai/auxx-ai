// packages/lib/src/seed/entity-migrations/migrations/019-tag-scope.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ResourceField } from '../../../resources/registry/field-types'
import { TAG_FIELDS } from '../../../resources/registry/resources/tag-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:019')

/**
 * Migration 019: Add `tag_scope` SINGLE_SELECT field on the tag entity and
 * backfill every existing tag to `'thread'`.
 *
 * Scope filters the picker pool — pre-articles, every tag was a thread tag, so
 * `'thread'` is the safe backfill that preserves existing behavior. Articles
 * will create their own scope='article' tags via the inline create flow.
 */
export const migration019TagScope: EntityMigration = {
  id: '019-tag-scope',
  description: 'Add tag.tag_scope SINGLE_SELECT field and backfill existing tags to "thread"',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const tagDef = existing.entityDefs.get('tag')
    if (!tagDef) {
      logger.warn('No tag entity found, skipping tag-scope migration', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    // 1. Ensure the tag_scope CustomField exists.
    const tagFieldsToEnsure: Record<string, ResourceField> = {
      tag_scope: TAG_FIELDS.tag_scope!,
    }
    const tagFieldMap = await ensureCustomFields(
      db,
      organizationId,
      'tag',
      tagDef.id,
      tagFieldsToEnsure,
      existing,
      state
    )

    const tagScopeField = tagFieldMap.get(`tag:${TAG_FIELDS.tag_scope!.id}`)
    if (!tagScopeField) {
      throw new Error('Failed to resolve tag_scope CustomField after ensureCustomFields')
    }

    // 2. Backfill: every tag instance without a tag_scope FieldValue gets 'thread'.
    const backfilled = await backfillTagScope(db, organizationId, tagDef.id, tagScopeField.id)

    const alreadyUpToDate = state.fieldsCreated === 0 && backfilled === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 019 applied', {
        organizationId,
        customFieldCreated: state.fieldsCreated > 0,
        tagsBackfilled: backfilled,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}

/**
 * Insert `tag_scope = 'thread'` for every tag instance that doesn't already
 * have a tag_scope FieldValue. Idempotent.
 */
async function backfillTagScope(
  db: Database,
  organizationId: string,
  tagDefId: string,
  tagScopeFieldId: string
): Promise<number> {
  const allTagInstances = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, tagDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  if (allTagInstances.length === 0) return 0

  const allInstanceIds = allTagInstances.map((t) => t.id)

  // Find which already have a tag_scope FieldValue.
  const existingScopeRows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, tagScopeFieldId),
        inArray(schema.FieldValue.entityId, allInstanceIds)
      )
    )

  const alreadyScoped = new Set(existingScopeRows.map((r) => r.entityId))
  const toInsert = allInstanceIds.filter((id) => !alreadyScoped.has(id))

  if (toInsert.length === 0) return 0

  const now = new Date()
  await db.insert(schema.FieldValue).values(
    toInsert.map((entityId) => ({
      organizationId,
      entityId,
      entityDefinitionId: tagDefId,
      fieldId: tagScopeFieldId,
      sortKey: generateKeyBetween(null, null),
      optionId: 'thread',
      updatedAt: now,
    }))
  )

  return toInsert.length
}
