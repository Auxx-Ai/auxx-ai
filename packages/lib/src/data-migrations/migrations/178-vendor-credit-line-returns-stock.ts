// packages/lib/src/data-migrations/migrations/178-vendor-credit-line-returns-stock.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { VENDOR_CREDIT_LINE_FIELDS } from '../../resources/registry/resources/vendor-credit-line-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:178')

const VENDOR_CREDIT_LINE_ENTITY_TYPE = 'vendor_credit_line'

/** Resolved out of {@link VENDOR_CREDIT_LINE_FIELDS}, so a stored field cannot disagree with a fresh org's. */
const NEW_FIELD_KEYS = ['returnsStock'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 178: a vendor credit line says whether it sends the goods back
 * (`plans/accounting/tasks/done/73-the-buy-side-against-the-ledger.md` §8.2).
 *
 * ## No backfill, deliberately
 *
 * Every credit issued before today moved no stock, and `false` is the field's
 * default — so an absent value already reads as the truth.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 178-vendor-credit-line-returns-stock`.
 */
export const migration178VendorCreditLineReturnsStock: PerOrgMigration = {
  id: '178-vendor-credit-line-returns-stock',
  description:
    'Adds vendor_credit_line.returnsStock - whether issuing the credit writes a return_out ' +
    'movement for the line and posts the return_to_vendor entry (73 §8.2)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const lineDef = existing.entityDefs.get(VENDOR_CREDIT_LINE_ENTITY_TYPE)
    if (!lineDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = VENDOR_CREDIT_LINE_FIELDS[key]
      if (!field) {
        throw new Error(
          `vendor-credit-line-fields registry is missing the key "${key}" (migration 178)`
        )
      }
      fields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      VENDOR_CREDIT_LINE_ENTITY_TYPE,
      lineDef.id,
      fields,
      existing,
      state
    )

    if (state.fieldsCreated > 0) {
      // The write bypasses the org cache and `UnifiedCrudHandler` resolves a
      // field's shape from it, so a stale entry would drop every flag write.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 178 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: state.fieldsCreated === 0 }
  },
}
