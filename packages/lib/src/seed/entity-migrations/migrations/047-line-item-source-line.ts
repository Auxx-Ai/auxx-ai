// packages/lib/src/seed/entity-migrations/migrations/047-line-item-source-line.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:047')

/**
 * Migration 047: add `line_item.sourceLine` (money plan 20 §E — early job from quote).
 * Plain-text provenance pointer stamped by `convertQuoteToWorkOrder` on each copied line:
 * the source quote-line's instance id. No reader in plan 20 — it exists so a future
 * accept-time auto-reconcile can diff an early job's snapshot against the accepted quote.
 *
 * Fresh orgs get the field for free via `LINE_ITEM_FIELDS` (entity-seeder); this only
 * backfills orgs that installed `line_item` (032) before the field existed. No value
 * backfill — pre-existing copies simply have no provenance, which is honest.
 */
export const migration047LineItemSourceLine: EntityMigration = {
  id: '047-line-item-source-line',
  description: 'Add line_item.sourceLine provenance field (money plan 20)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const lineItemDef = existing.entityDefs.get('line_item')
    if (!lineItemDef) {
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'line_item',
      lineItemDef.id,
      { sourceLine: LINE_ITEM_FIELDS.sourceLine! },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 047 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
