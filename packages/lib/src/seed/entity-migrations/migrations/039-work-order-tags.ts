// packages/lib/src/seed/entity-migrations/migrations/039-work-order-tags.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { WORK_ORDER_FIELDS } from '../../../resources/registry/resources/work-order-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:039')

/**
 * Migration 039: add the `work_order.tags` field (route planner build contract item 10) —
 * free-form TAGS narrowing the route planner's map/backlog list by region. Mirrors the 036
 * `invoice.publicToken` single-field recipe: fresh orgs get it for free via `WORK_ORDER_FIELDS`
 * (entity-seeder); this migration backfills orgs that installed `work_order` (029) before this
 * field existed.
 *
 * See plans/dispatch/09-route-planner.md §B.
 */
export const migration039WorkOrderTags: EntityMigration = {
  id: '039-work-order-tags',
  description: 'Add work_order.tags field (route planner regions)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const workOrderDef = existing.entityDefs.get('work_order')
    if (!workOrderDef) {
      // Org never got work_order (029) — nothing to backfill; entity-seeder brings tags along
      // whenever work_order is first created.
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'work_order',
      workOrderDef.id,
      { tags: WORK_ORDER_FIELDS.tags! },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 039 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
