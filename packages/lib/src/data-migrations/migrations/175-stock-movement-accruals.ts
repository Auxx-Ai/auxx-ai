// packages/lib/src/data-migrations/migrations/175-stock-movement-accruals.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:175')

const STOCK_MOVEMENT_ENTITY_TYPE = 'stock_movement'

/** Resolved out of {@link STOCK_MOVEMENT_FIELDS}, so a stored field cannot disagree with a fresh org's. */
const NEW_FIELD_KEYS = ['freightAccrued', 'dutiesAccrued', 'tariffRate'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 175: a receipt records what it accrued
 * (`plans/accounting/tasks/done/73-the-buy-side-against-the-ledger.md` §7.2).
 *
 * The standard is landed, so a receipt valued at standard has capitalised money
 * the carrier and the customs broker will invoice separately. Its entry credits
 * `freight_accrual` and `duties_accrual` for their shares; these three fields
 * are what each movement says it put there, plus the duty rate in force when it
 * was valued.
 *
 * ## Stamped, not re-derived
 *
 * The `vendor_part` row those numbers came from is standing terms that move. An
 * accrual account can only be reconciled against the receipts that raised it if
 * each row carries its own figure, and a rate change months later must not
 * restate what a shipment owed.
 *
 * ## No backfill, deliberately
 *
 * Every movement written before today accrued nothing - its entry credited
 * `grni` for the whole cost - so a NULL here is the truth, not a gap.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 175-stock-movement-accruals`.
 */
export const migration175StockMovementAccruals: PerOrgMigration = {
  id: '175-stock-movement-accruals',
  description:
    'Adds stock_movement.freightAccrued / dutiesAccrued / tariffRate - what a receipt credited ' +
    'the freight and duties accrual accounts, and the duty rate that produced it. No backfill: a ' +
    'movement written before 73 §7.2 accrued nothing (73 §7.2)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const movementDef = existing.entityDefs.get(STOCK_MOVEMENT_ENTITY_TYPE)
    if (!movementDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = STOCK_MOVEMENT_FIELDS[key]
      if (!field) {
        throw new Error(
          `stock-movement-fields registry is missing the key "${key}" (migration 175)`
        )
      }
      fields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      STOCK_MOVEMENT_ENTITY_TYPE,
      movementDef.id,
      fields,
      existing,
      state
    )

    if (state.fieldsCreated > 0) {
      // The write bypasses the org cache and `UnifiedCrudHandler` resolves a
      // field's shape from it, so a stale entry would drop every accrual write.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 175 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: state.fieldsCreated === 0 }
  },
}
