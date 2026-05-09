// packages/lib/src/seed/entity-migrations/migrations/018-article-tags.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { ARTICLE_FIELDS } from '../../../resources/registry/resources/article-fields'
import { TAG_FIELDS } from '../../../resources/registry/resources/tag-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:018')

/**
 * Migration 018: Add Article entity definition + article_tags ↔ tag_articles
 * relationship + tag_is_public flag.
 *
 * Articles live in the dedicated Article table, but they get a parallel
 * EntityDefinition row so the FieldValue ecosystem can attach tag relationships
 * the same way it does for threads.
 */
export const migration018ArticleTags: EntityMigration = {
  id: '018-article-tags',
  description:
    'Add article entity definition + article_tags ↔ tag_articles relationship + tag_is_public',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // 1) Ensure article EntityDefinition exists
    const articleEntities = SYSTEM_ENTITIES.filter((e) => e.entityType === 'article')
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      articleEntities,
      existing,
      state
    )

    // Tag entity must already exist (created by an earlier migration / seeder).
    const tagDef = existing.entityDefs.get('tag')
    if (!tagDef) {
      logger.warn('No tag entity found, skipping article tags migration', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }
    entityDefIds.set('tag', tagDef.id)

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()

    // 2) Ensure article CustomFields (all of ARTICLE_FIELDS)
    const articleDefId = entityDefIds.get('article')
    if (articleDefId) {
      const articleFields = await ensureCustomFields(
        db,
        organizationId,
        'article',
        articleDefId,
        ARTICLE_FIELDS,
        existing,
        state
      )
      for (const [k, v] of articleFields) allFieldMaps.set(k, v)
    }

    // 3) Ensure new tag CustomFields (tag_articles + is_public).
    //    Pass only the new fields so existing tag fields are not re-touched.
    const tagFieldsToEnsure: Record<string, ResourceField> = {
      tag_articles: TAG_FIELDS.tag_articles!,
      is_public: TAG_FIELDS.is_public!,
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
    for (const [k, v] of tagFieldMap) allFieldMaps.set(k, v)

    // 4) Link the inverse relationship (article:tags ↔ tag:tag_articles).
    //    linkNewRelationships skips fields that already have an inverse linked,
    //    so existing thread.tags ↔ tag.tag_threads is untouched.
    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)

    // 5) Link display fields for the new article entity definition.
    await linkDisplayFields(db, ['article'], entityDefIds, allFieldMaps)

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 018 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
