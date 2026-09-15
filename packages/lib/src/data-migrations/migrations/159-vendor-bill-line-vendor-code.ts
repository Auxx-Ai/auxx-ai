// packages/lib/src/data-migrations/migrations/159-vendor-bill-line-vendor-code.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { VENDOR_BILL_LINE_FIELDS } from '../../resources/registry/resources/vendor-bill-line-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:159')

const VENDOR_BILL_LINE_ENTITY_TYPE = 'vendor_bill_line'

/**
 * The registry keys this migration provisions, resolved out of
 * {@link VENDOR_BILL_LINE_FIELDS} rather than restated here, so the stored field
 * can never disagree with the one a fresh org is seeded with. The key itself is
 * checked, because a rename in the registry with no rename here would otherwise
 * create nothing while claiming one field and say nothing.
 */
const NEW_FIELD_KEYS = ['vendorCode'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 159: `vendor_bill_line` learns the vendor's own printed code for
 * the line (`plans/money/tasks/58-vendor-bill-from-the-invoice.md` §7.1).
 *
 * ## Why a migration and not just the registry edit
 *
 * `EntityDefinition` and `CustomField` rows are seeded per org from the
 * resource registry, and `ensureCustomFields` is INSERT-only, so a registry
 * edit reaches FRESH orgs and nothing else. Every org that already has a
 * `vendor_bill_line` def needs this migration to see the field at all: without
 * it a bill-intake write to `vendorCode` resolves no target and drops the
 * value with a log line.
 *
 * ## What it adds
 *
 * - **`vendor_bill_line_vendor_code`**, TEXT, nullable. The strongest match
 *   signal a bill line has: the vendor's own code for the line, as printed on
 *   their invoice, never the part's SKU. It is a FIELD and not a Redis-only
 *   fact because the bill-intake run store expires in 24 hours (§4.3), and
 *   without a stored code, "Match lines" on a bill read yesterday degrades
 *   from reading the printed code to the fuzzy tier (fuzzy description/amount
 *   matching against the order's lines). It is also the bill-side twin of the
 *   quote intake's write-back to `vendor_part.vendorSku` (§11 item 4): the
 *   thing a person would accept as the vendor's SKU for a part.
 *
 * ## No backfill, and there is nothing to backfill
 *
 * Nothing has ever written this field, because it did not exist until now.
 * Every bill line that exists today was created by hand or by the PO-to-bill
 * prefill, neither of which ever saw the vendor's printed document closely
 * enough to know its line code. Null everywhere is the correct starting state;
 * the value arrives on the bill's next read through the intake this brief
 * builds.
 *
 * ## Ordering
 *
 * An org short of the `vendor_bill_line` def is a SKIP rather than a failure:
 * a fresh install brings the def and this field together from the registry.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only and skips whatever the org
 * already holds, so a re-run writes nothing and reports `alreadyUpToDate`.
 * Safe to re-apply with `packages/lib/scripts/run-entity-migration.ts --id
 * 159-vendor-bill-line-vendor-code`.
 */
export const migration159VendorBillLineVendorCode: PerOrgMigration = {
  id: '159-vendor-bill-line-vendor-code',
  description:
    "Adds vendor_bill_line.vendorCode (TEXT, nullable) - the vendor's own printed code for the " +
    'line, the strongest match signal a bill line has and never the same as the part SKU. No ' +
    'backfill: nothing has ever written it, and it arrives on the bill next read through the ' +
    'intake (plans/money/tasks/58-vendor-bill-from-the-invoice.md §7.1)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const vendorBillLineDef = existing.entityDefs.get(VENDOR_BILL_LINE_ENTITY_TYPE)
    if (!vendorBillLineDef) {
      // The org never got a `vendor_bill_line` def. A fresh install brings the
      // def and this field along together from the registry.
      return { ...state, alreadyUpToDate: true }
    }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = VENDOR_BILL_LINE_FIELDS[key]
      if (!field) {
        throw new Error(
          `vendor-bill-line-fields registry is missing the key "${key}" (migration 159)`
        )
      }
      fields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      VENDOR_BILL_LINE_ENTITY_TYPE,
      vendorBillLineDef.id,
      fields,
      existing,
      state
    )

    const changed = state.fieldsCreated > 0

    if (changed) {
      // `ensureCustomFields` bypasses the org cache and `UnifiedCrudHandler`
      // resolves a field's shape from it, so a stale entry would keep
      // dropping every write to this field. `perOrgMigration` flushes after
      // the whole batch, but `up()` is also called directly by
      // `scripts/run-entity-migration.ts`, so do it here too (as 151 and 156
      // do).
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 159 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
