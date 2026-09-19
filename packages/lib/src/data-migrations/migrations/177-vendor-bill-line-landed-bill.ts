// packages/lib/src/data-migrations/migrations/177-vendor-bill-line-landed-bill.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../resources/registry/resources/vendor-bill-line-fields'
import {
  ensureCustomFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:177')

const VENDOR_BILL = 'vendor_bill'
const VENDOR_BILL_LINE = 'vendor_bill_line'

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 177: a landed-cost line names the goods bill it belongs to
 * (`plans/accounting/tasks/73-the-buy-side-against-the-ledger.md` §7.2).
 *
 * `vendor_bill_line.landedBill` -> `vendor_bill`, beside the line's order-line
 * link, with `vendor_bill.landedCostLines` as its `unlink` inverse. A carrier's
 * freight line or a broker's duty line says which shipment it was charged
 * against; the three-way match skips it as it skips any unlinked line.
 *
 * No backfill: nothing wrote this edge before today, so an empty cell is the
 * truth. Idempotent - `ensureCustomFields` is INSERT-only, `linkNewRelationships`
 * only fills a missing inverse. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 177-vendor-bill-line-landed-bill`.
 */
export const migration177VendorBillLineLandedBill: PerOrgMigration = {
  id: '177-vendor-bill-line-landed-bill',
  description:
    'Adds vendor_bill_line.landedBill -> vendor_bill and its vendor_bill.landedCostLines inverse ' +
    "- the goods bill a carrier's freight line or a broker's duty line was charged against " +
    '(73 §7.2). No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const billDef = existing.entityDefs.get(VENDOR_BILL)
    const lineDef = existing.entityDefs.get(VENDOR_BILL_LINE)
    if (!billDef || !lineDef) return { ...state, alreadyUpToDate: true }

    const lineField = VENDOR_BILL_LINE_FIELDS.landedBill as ResourceField | undefined
    const billField = VENDOR_BILL_FIELDS.landedCostLines as ResourceField | undefined
    if (!lineField || !billField) {
      throw new Error('The vendor-bill registries are missing the landed-bill pair (migration 177)')
    }

    const lineFields = await ensureCustomFields(
      db,
      organizationId,
      VENDOR_BILL_LINE,
      lineDef.id,
      { landedBill: lineField },
      existing,
      state
    )
    const billFields = await ensureCustomFields(
      db,
      organizationId,
      VENDOR_BILL,
      billDef.id,
      { landedCostLines: billField },
      existing,
      state
    )

    await linkNewRelationships(
      db,
      new Map([...lineFields, ...billFields]),
      new Map([
        [VENDOR_BILL, billDef.id],
        [VENDOR_BILL_LINE, lineDef.id],
      ]),
      state
    )

    const changed = state.fieldsCreated > 0 || state.relationshipsLinked > 0
    if (changed) {
      // The writes bypass the org cache and `UnifiedCrudHandler` resolves a
      // field's shape from it, so a stale entry would drop every landed-bill write.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 177 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
        relationshipsLinked: state.relationshipsLinked,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
