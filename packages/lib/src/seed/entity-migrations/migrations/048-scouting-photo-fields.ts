// packages/lib/src/seed/entity-migrations/migrations/048-scouting-photo-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:048')

/**
 * Migration 048: materialize the scouting-photo FILE fields (plan 37b) —
 * `quote.photos`, `line_item.photos`, `invoice.photos`. 37b assumed registry-declared
 * fields "need no migration", but `FieldValue.fieldId` has an FK to `CustomField.id`:
 * without a materialized row, the first photo upload fails with an FK violation
 * (the unmaterialized field resolves to the bare registry id `photos`).
 *
 * Fresh orgs get the fields for free via the entity-seeder registries; this backfills
 * orgs seeded before 37b. No value backfill — the fields are new, so no rows exist.
 */
export const migration048ScoutingPhotoFields: EntityMigration = {
  id: '048-scouting-photo-fields',
  description: 'Materialize quote/line_item/invoice photos fields (plan 37b)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const targets = [
      { entityType: 'quote', fields: { photos: QUOTE_FIELDS.photos! } },
      { entityType: 'line_item', fields: { photos: LINE_ITEM_FIELDS.photos! } },
      { entityType: 'invoice', fields: { photos: INVOICE_FIELDS.photos! } },
    ]

    for (const { entityType, fields } of targets) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue
      await ensureCustomFields(db, organizationId, entityType, def.id, fields, existing, state)
    }

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 048 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
