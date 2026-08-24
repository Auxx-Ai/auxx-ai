// packages/lib/src/seed/entity-migrations/migrations/103-gl-posting.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { GL_POSTING_FIELDS } from '../../../resources/registry/resources/gl-posting-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:103')

/**
 * Migration 103: the `gl_posting` entity — one summary journal entry pushed to
 * the general ledger (plans/auxx-lift/gap-b-quickbooks-journal-entry.md §6.2).
 *
 * Def + GL_POSTING_FIELDS. **No relationships**: a GL posting summarises a
 * window, not a record. Tying it to a `fulfillment` or an `order` would be
 * wrong at exactly the grain that matters — one entry covers many of both, and
 * a dealer order can straddle two periods.
 *
 * The external QuickBooks id is deliberately NOT a field here. It is an
 * app-owned identity field (`qboJournalEntryId`, scope `connection`) declared in
 * the QuickBooks app's `fields.ts`, so it carries the write-through
 * `RecordIdentity` mirror and goes away with the connection.
 *
 * **No DDL.** `EntityDefinition.entityType` is a `text()` column, so a new
 * entity type is this migration plus the hand-edits to `enums.ts`,
 * `constants.ts`, `field-registry.ts`, `create-fields.ts`,
 * `types/resource/utils.ts` and the system-attribute union. Mirrors the 101
 * recipe.
 *
 * Note the id space is shared across `data-migrations/migrations/` and
 * `seed/entity-migrations/migrations/` — 103 is the next free number counted
 * across BOTH, not just this directory.
 *
 * Idempotent — every helper is insert-only or skips existing rows.
 */
export const migration103GlPosting: EntityMigration = {
  id: '103-gl-posting',
  description: 'Add gl_posting as a hidden system entity for general-ledger journal entries',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === 'gl_posting'),
      existing,
      state
    )

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()

    const glPostingDefId = entityDefIds.get('gl_posting')
    if (glPostingDefId) {
      for (const [key, value] of await ensureCustomFields(
        db,
        organizationId,
        'gl_posting',
        glPostingDefId,
        GL_POSTING_FIELDS,
        existing,
        state
      )) {
        allFieldMaps.set(key, value)
      }
    }

    await linkDisplayFields(db, ['gl_posting'], entityDefIds, allFieldMaps)

    // No `ensureFieldViews`: the entity is `isVisible: false` and has no panel
    // or detail page, so a seeded view would have nothing to render into.

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 103 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
