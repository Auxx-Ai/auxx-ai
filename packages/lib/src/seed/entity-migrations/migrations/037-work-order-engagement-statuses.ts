// packages/lib/src/seed/entity-migrations/migrations/037-work-order-engagement-statuses.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:037')

/**
 * Migration 037: Add `active` / `paused` / `ended` options to `work_order_status`
 * (dispatch M2c recurring engine, plans/dispatch/06-recurring-engine.md §3.3) —
 * the engagement-lifecycle superset for recurring work orders. Fresh orgs get these for free via
 * `WORK_ORDER_STATUS_OPTIONS` (resources/registry/resources/work-order-fields.ts); this migration
 * backfills orgs that installed `work_order` (029) before these options existed.
 *
 * `ensureCustomFields` does NOT update an existing field's options (helpers.ts `loadExistingState`
 * returns the row untouched), so this uses the bespoke `.update` recipe from
 * `003-bom-stock-movement-fields.ts` instead.
 */
export const migration037WorkOrderEngagementStatuses: EntityMigration = {
  id: '037-work-order-engagement-statuses',
  description: 'Add active/paused/ended options to work_order_status (dispatch M2c recurring)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const workOrderDef = existing.entityDefs.get('work_order')
    if (!workOrderDef) {
      // Org never got 029's work_order entity — nothing to backfill; fresh installs bring the
      // full option set along via WORK_ORDER_STATUS_OPTIONS.
      return { ...state, alreadyUpToDate: true }
    }

    const statusField = [...existing.fields.values()].find(
      (f) => f.entityDefinitionId === workOrderDef.id && f.systemAttribute === 'work_order_status'
    )
    if (!statusField) {
      return { ...state, alreadyUpToDate: true }
    }

    const currentOptions = (statusField.options as any)?.options ?? []
    const hasActive = currentOptions.some((o: any) => o.value === 'active')
    if (hasActive) {
      return { ...state, alreadyUpToDate: true }
    }

    const missingOptions = [
      { label: 'Active', value: 'active', color: 'green' },
      { label: 'Paused', value: 'paused', color: 'amber' },
      { label: 'Ended', value: 'ended', color: 'gray' },
    ].filter((opt) => !currentOptions.some((o: any) => o.value === opt.value))

    const updatedOptions = [...currentOptions, ...missingOptions]
    await db
      .update(schema.CustomField)
      .set({
        options: { ...(statusField.options as any), options: updatedOptions },
        updatedAt: new Date(),
      })
      .where(eq(schema.CustomField.id, statusField.id))

    logger.info('Migration 037 applied', { organizationId, added: missingOptions.length })

    return { ...state, alreadyUpToDate: false }
  },
}
