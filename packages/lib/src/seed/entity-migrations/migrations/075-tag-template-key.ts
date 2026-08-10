// packages/lib/src/seed/entity-migrations/migrations/075-tag-template-key.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { ResourceField } from '../../../resources/registry/field-types'
import { TAG_FIELDS } from '../../../resources/registry/resources/tag-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:075')

/**
 * Migration 075: add the `tag_template_key` TEXT field to the `tag` entity
 * (plans/mail-filter/06-mail-categories-rework-plan.md §3.1).
 *
 * The field holds the shipped identity of a seeded mail category
 * (`category:sales`, `category:order-status`, …) and is null on every
 * user-created tag. It is a **provenance marker, not a lock**: unlike
 * `is_system_tag` it freezes no field, so a business can re-word a category's
 * `tag_description` — which is the classifier's instruction (D4/D5).
 *
 * A new registry system field is NOT a Drizzle migration — nothing can write a
 * `FieldValue` for it until a `CustomField` row exists on the org's `tag`
 * EntityDefinition, and the first write without one is an FK violation rather
 * than a clean error. New orgs get the field from the entity seeder, which reads
 * `TAG_FIELDS` directly; this catches up every existing org. Same shape as 074.
 *
 * **No value backfill, on purpose.** Stamping `tag_template_key` onto existing
 * tags is the taxonomy data migration's job (§5), and it has rules this
 * migration cannot express — adopt by `is_system_tag` flag and never by title
 * (invariant 5), and never clobber an edited description (invariant 6). Writing
 * a key here would also make the marked tags undeletable before anything has
 * decided which tags deserve that.
 *
 * ⚠️ **Id `075`, and the taxonomy data migration is `076`.** The `NNN-` id space
 * is shared across `data-migrations/` and `seed/entity-migrations/`, so the two
 * must not both claim `075` (§3.1).
 *
 * The **resources cache clear** is the runner's, not ours: both
 * `runEntityMigrationsForOrg` and `runEntityMigrationForAllOrgs` invalidate
 * `entityDefs`/`entityDefSlugs`/`customFields`/`resources` for any org where
 * `fieldsCreated > 0`, which is exactly what this migration reports. Do not
 * duplicate it here.
 *
 * Idempotent: `ensureCustomFields` skips the insert when a row with this
 * `systemAttribute` already exists on the org's tag def, and this migration
 * touches no tag instance and no `FieldValue` at all.
 */
export const migration075TagTemplateKey: EntityMigration = {
  id: '075-tag-template-key',
  description: 'Add tag.tag_template_key TEXT field (seeded mail-category provenance marker)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const tagDef = existing.entityDefs.get('tag')
    if (!tagDef) {
      // No tag entity — pre-seed or manually pruned. Nothing to migrate.
      logger.warn('No tag entity found, skipping tag-template-key migration', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    const field = TAG_FIELDS.tag_template_key
    if (!field) {
      throw new Error('TAG_FIELDS.tag_template_key is missing from the registry')
    }

    const fields: Record<string, ResourceField> = { tag_template_key: field }
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
      throw new Error('Failed to resolve tag_template_key CustomField after ensureCustomFields')
    }

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 075 applied', { organizationId, customFieldCreated: true })
    }

    return { ...state, alreadyUpToDate }
  },
}
