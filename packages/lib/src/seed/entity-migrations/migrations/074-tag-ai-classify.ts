// packages/lib/src/seed/entity-migrations/migrations/074-tag-ai-classify.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { ResourceField } from '../../../resources/registry/field-types'
import { TAG_FIELDS } from '../../../resources/registry/resources/tag-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:074')

/**
 * Migration 074: add the `tag_ai_classify` CHECKBOX field to the `tag` entity
 * (plans/mail-filter/05-mail-classification-plan.md §2.1).
 *
 * A new registry system field is NOT a Drizzle migration — nothing can write a
 * `FieldValue` for it until a `CustomField` row exists on the org's `tag`
 * EntityDefinition, and the first write without one is an FK violation rather
 * than a clean error (invariant 14). New orgs get the field from the entity
 * seeder, which reads `TAG_FIELDS` directly; this catches up every existing org.
 *
 * **No value backfill, on purpose.** Absence reads as `false` everywhere
 * (`tag-service.ts`'s `?? false`, and the registry's `defaultValue: false`), and
 * eligibility must start empty: a migration that flipped tags on would enrol an
 * org's taxonomy into a classifier nobody asked for. The five starter categories
 * are seeded separately (`seed/ai-category-tags.ts`), and the per-inbox opt-in is
 * a separate switch again — nothing classifies because this ran.
 *
 * The **resources cache clear** §2.1 requires is the runner's, not ours: both
 * `runEntityMigrationsForOrg` and `runEntityMigrationForAllOrgs` invalidate
 * `entityDefs`/`entityDefSlugs`/`customFields`/`resources` for any org where
 * `fieldsCreated > 0`, which is exactly what this migration reports. Do not
 * duplicate it here.
 *
 * Idempotent: `ensureCustomFields` skips the insert when a row with this
 * `systemAttribute` already exists on the org's tag def, and this migration
 * touches no tag instance and no `FieldValue` at all.
 */
export const migration074TagAiClassify: EntityMigration = {
  id: '074-tag-ai-classify',
  description: 'Add tag.tag_ai_classify CHECKBOX field (AI mail-classification eligibility)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const tagDef = existing.entityDefs.get('tag')
    if (!tagDef) {
      // No tag entity — pre-seed or manually pruned. Nothing to migrate.
      logger.warn('No tag entity found, skipping tag-ai-classify migration', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    const field = TAG_FIELDS.tag_ai_classify
    if (!field) {
      throw new Error('TAG_FIELDS.tag_ai_classify is missing from the registry')
    }

    const fields: Record<string, ResourceField> = { tag_ai_classify: field }
    const fieldMap = await ensureCustomFields(
      db,
      organizationId,
      'tag',
      tagDef.id,
      fields,
      existing,
      state
    )

    if (!fieldMap.get(`tag:${field.id}`)) {
      throw new Error('Failed to resolve tag_ai_classify CustomField after ensureCustomFields')
    }

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 074 applied', { organizationId, customFieldCreated: true })
    }

    return { ...state, alreadyUpToDate }
  },
}
