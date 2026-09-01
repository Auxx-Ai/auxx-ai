// packages/lib/src/seed/entity-migrations/migrations/121-rate-precision.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:121')

/**
 * The nineteen RATE attributes (plans/money/tasks/31-sub-cent-rates.md §2.2):
 * money per one of something, as opposed to an AMOUNT (a total, a balance, an
 * extended cost), which stays at the currency's exponent. Kept as
 * `(entityType, systemAttribute)` pairs, not "everything CURRENCY on these
 * defs", so a future amount field added to one of these entities cannot
 * silently join this migration's payload.
 *
 * Mirrored by the registry field files (`vendor-part-fields.ts`, `part-fields.ts`,
 * `purchase-order-line-fields.ts`, `vendor-bill-line-fields.ts`,
 * `stock-movement-fields.ts`, `line-item-fields.ts`, `catalog-item-fields.ts`),
 * which is what a FRESH org gets for free. This migration is what an EXISTING
 * org gets, because `ensureCustomFields` never rewrites an existing field's
 * `options` (HANDOFF §6): this migration's own test pins that the two lists
 * agree.
 */
const RATE_FIELDS: ReadonlyArray<{ entityType: string; systemAttribute: string }> = [
  { entityType: 'vendor_part', systemAttribute: 'vendor_part_unit_price' },
  { entityType: 'vendor_part', systemAttribute: 'vendor_part_shipping_cost' },
  { entityType: 'vendor_part', systemAttribute: 'vendor_part_other_cost' },
  { entityType: 'part', systemAttribute: 'part_cost' },
  { entityType: 'part', systemAttribute: 'part_purchase_cost' },
  { entityType: 'part', systemAttribute: 'part_rollup_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_material_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_labor_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_overhead_cost' },
  { entityType: 'part', systemAttribute: 'part_labor_cost_per_unit' },
  { entityType: 'part', systemAttribute: 'part_overhead_cost_per_unit' },
  {
    entityType: 'purchase_order_line',
    systemAttribute: 'purchase_order_line_expected_unit_price',
  },
  { entityType: 'vendor_bill_line', systemAttribute: 'vendor_bill_line_unit_price' },
  { entityType: 'stock_movement', systemAttribute: 'stock_movement_unit_cost' },
  { entityType: 'stock_movement', systemAttribute: 'stock_movement_vendor_unit_price' },
  { entityType: 'line_item', systemAttribute: 'line_item_unit_price' },
  { entityType: 'catalog_item', systemAttribute: 'catalog_item_cost' },
  { entityType: 'catalog_item', systemAttribute: 'catalog_item_default_unit_price' },
] as const

/** The two B-lite entry-conversion fields added to `vendor_part` (§2.9). */
const VENDOR_PART_NEW_FIELD_KEYS = ['purchaseUnit', 'purchaseRatio'] as const

/**
 * Merge `decimals: RATE_DECIMALS` into a field's stored `options`, tolerating
 * both shapes seen in the database:
 *
 * - flat, `{ decimals: 2, currencyCode: 'USD', ... }`: `decimals` is
 *   overwritten in place, every other key survives.
 * - legacy nested, `{ currency: { decimalPlaces: 'two-places', ... }, ... }`:
 *   the nested `currency` object is untouched (nothing reads it as a
 *   precision source any more); the flat `decimals` key is added ALONGSIDE
 *   it, which is what `isAtPrecision`/`fractionalMinorPlaces` actually read.
 *
 * Both cases reduce to the same shallow merge, because the legacy shape's
 * precision-bearing key is namespaced under `currency` and never collides
 * with the top-level `decimals` this writes.
 */
export function withRateDecimals(options: unknown): Record<string, unknown> {
  const base = options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
  return { ...base, decimals: RATE_DECIMALS }
}

/** True when `options.decimals` is already exactly `RATE_DECIMALS`: nothing to write. */
function isAlreadyAtRateDecimals(options: unknown): boolean {
  return (
    !!options &&
    typeof options === 'object' &&
    (options as Record<string, unknown>).decimals === RATE_DECIMALS
  )
}

/**
 * Migration 121: rate precision
 * (plans/money/tasks/31-sub-cent-rates.md §2.7, §2.9).
 *
 * Two independent halves, both no-ops on an org that has not reached the
 * entity type they touch yet: a later run of this migration, or the fresh
 * seeder, picks it up once that entity exists.
 *
 * ## Half 1: `options.decimals = 5` on the nineteen rate fields
 *
 * `ensureCustomFields` is insert-only: it never rewrites an existing field's
 * `options` (HANDOFF §6). Without this migration every org seeded before this
 * change keeps `decimals: 2` (or unset) on a rate field forever, and the
 * write guard (`assertCurrencyAtFieldPrecision`) would keep refusing the very
 * sub-cent rates this brief exists to allow.
 *
 * ## Half 2: the B-lite offer fields
 *
 * `vendor_part.purchaseUnit` / `purchaseRatio` (§2.9): the vendor's selling
 * unit and how many tracking units it holds, an entry conversion on the
 * offer's price field only. Backfilled the same way migration 119 added
 * `vendor_part.tariffCode` to an existing def.
 *
 * ## ✅ No FieldValue is rewritten
 *
 * Every stored rate is a whole number of cents today and stays one: a
 * five-place field renders a whole-cent value identically (display's
 * minimum-is-exponent rule, §2.4). PO-0013 and its wrong offers are wrong
 * DATA, not migratable data: re-keying the true rates from the vendor
 * quotation is the owner's action after deploy, not this migration's.
 *
 * Idempotent: a field already at `decimals: 5` is left alone (no spurious
 * `updatedAt` bump on a re-run); a field that already exists is skipped by
 * `ensureCustomFields`.
 */
export const migration121RatePrecision: EntityMigration = {
  id: '121-rate-precision',
  description:
    'Set decimals=5 on the nineteen rate fields; add vendor_part purchaseUnit/purchaseRatio',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    let optionsUpdated = 0

    // ── Half 1: decimals = 5 on the nineteen rate fields ────────────────
    for (const { entityType, systemAttribute } of RATE_FIELDS) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue // org has not reached the entity type yet

      const field = existing.fields.get(fieldKey(def.id, systemAttribute))
      if (!field) continue // field does not exist yet; it will be seeded at decimals:5 already

      if (isAlreadyAtRateDecimals(field.options)) continue

      await db
        .update(schema.CustomField)
        .set({ options: withRateDecimals(field.options), updatedAt: new Date() })
        .where(eq(schema.CustomField.id, field.id))

      optionsUpdated++
    }

    // ── Half 2: the two B-lite fields on vendor_part ────────────────────
    const vendorPartDef = existing.entityDefs.get('vendor_part')
    if (vendorPartDef) {
      const newFields: Record<string, ResourceField> = {}
      for (const key of VENDOR_PART_NEW_FIELD_KEYS) {
        const field = VENDOR_PART_FIELDS[key]
        // Loud rather than silent: a renamed registry key would otherwise make
        // this migration quietly create one field fewer than it claims to.
        if (!field) {
          throw new Error(`vendor_part registry is missing the key "${key}" (migration 121)`)
        }
        newFields[key] = field
      }
      await ensureCustomFields(
        db,
        organizationId,
        'vendor_part',
        vendorPartDef.id,
        newFields,
        existing,
        state
      )
    }

    const alreadyUpToDate = optionsUpdated === 0 && state.fieldsCreated === 0

    // Rate precision and the new offer fields are invisible to every read path
    // until the per-org caches that serve them are dropped.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 121 applied', {
        organizationId,
        optionsUpdated,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
