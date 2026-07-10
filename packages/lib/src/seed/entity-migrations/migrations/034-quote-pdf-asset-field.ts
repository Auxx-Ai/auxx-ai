// packages/lib/src/seed/entity-migrations/migrations/034-quote-pdf-asset-field.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:034')

/**
 * Migration 034: Add the hidden `pdfAsset` field to the `quote` entity (money MQ2 build
 * spec §C.1) — the `visitId`-style plain-text pointer the render-or-reuse service
 * (`ensureQuotePdf`) uses to track the MediaAsset id of the last-rendered PDF. Fresh
 * orgs get it for free via `QUOTE_FIELDS` (entity-seeder/create-fields.ts); this
 * migration backfills orgs that installed `quote` before this field existed (032).
 *
 * No DDL — `capabilities.hidden: true` on the registry field is what keeps it out of
 * every user-facing UI surface (panel/table/filter/sort/import/export/workflow pickers).
 */
export const migration034QuotePdfAssetField: EntityMigration = {
  id: '034-quote-pdf-asset-field',
  description: 'Add hidden quote.pdfAsset field (money MQ2 render-or-reuse pointer)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const quoteDef = existing.entityDefs.get('quote')
    if (!quoteDef) {
      // Org never got MQ1's quote entity (pre-032 fresh org or quote intentionally
      // absent) — nothing to backfill, 032/entity-seeder will bring pdfAsset along
      // whenever quote itself is created.
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'quote',
      quoteDef.id,
      { pdfAsset: QUOTE_FIELDS.pdfAsset! },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 034 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
