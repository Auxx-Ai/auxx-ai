// packages/lib/src/seed/entity-migrations/migrations/020-article-new-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { ARTICLE_FIELDS } from '../../../resources/registry/resources/article-fields'
import { ensureCustomFields, linkNewRelationships, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:020')

/**
 * Migration 020: Add the article fields that landed after 018 — slug, excerpt,
 * emoji, color, archivedAt, isPublished, hasUnpublishedChanges — plus the
 * `children` inverse for the self-referential parent relationship.
 *
 * Also re-runs relationship linking so the previously-orphaned
 * `article:parent → article:children` inverse gets connected now that
 * `children` exists.
 */
const NEW_FIELD_KEYS = [
  'slug',
  'excerpt',
  'emoji',
  'color',
  'archivedAt',
  'isPublished',
  'hasUnpublishedChanges',
  'children',
  'parent',
] as const

export const migration020ArticleNewFields: EntityMigration = {
  id: '020-article-new-fields',
  description:
    'Add article slug/excerpt/emoji/color/archivedAt/isPublished/hasUnpublishedChanges + parent↔children inverse',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const articleDef = existing.entityDefs.get('article')
    if (!articleDef) {
      logger.warn('No article entity found, skipping migration 020', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    const fieldsToEnsure: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const def = ARTICLE_FIELDS[key]
      if (def) fieldsToEnsure[key] = def
    }

    const articleFieldMap = await ensureCustomFields(
      db,
      organizationId,
      'article',
      articleDef.id,
      fieldsToEnsure,
      existing,
      state
    )

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()
    for (const [k, v] of articleFieldMap) allFieldMaps.set(k, v)

    const entityDefIds = new Map<string, string>([['article', articleDef.id]])

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)

    const alreadyUpToDate = state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 020 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
