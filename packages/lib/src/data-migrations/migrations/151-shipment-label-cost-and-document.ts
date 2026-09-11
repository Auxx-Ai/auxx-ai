// packages/lib/src/data-migrations/migrations/151-shipment-label-cost-and-document.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { SHIPMENT_FIELDS } from '../../resources/registry/resources/shipment-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:151')

const SHIPMENT_ENTITY_TYPE = 'shipment'

/**
 * The registry keys this migration provisions, in panel order.
 *
 * Named as KEYS and resolved out of `SHIPMENT_FIELDS` below, rather than
 * restated as literals here, so the stored field can never disagree with the
 * one a fresh org is seeded with. The keys themselves are checked, because a
 * rename in the registry with no rename here would otherwise create three
 * fields while claiming four and say nothing.
 */
const NEW_FIELD_KEYS = ['costMinor', 'insuranceCostMinor', 'insuranceClaim', 'labelUrl'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 151: `shipment` learns what the label COST and where the PDF is
 * (`plans/apps/shipstation/shipstation-status-and-linking-plan.md` §7).
 *
 * ## Why a migration and not just the registry edit
 *
 * `EntityDefinition` and `CustomField` rows are seeded per org from the resource
 * registry, and `ensureCustomFields` is INSERT-only, so a registry edit reaches
 * FRESH orgs and nothing else. Every org that already took migration 149's
 * `shipment` def needs this to see the four new fields at all: without them the
 * connector's mapping resolves no target and drops the value with a log line.
 *
 * ## What it adds
 *
 * - **`shipment_cost`** and **`shipment_insurance_cost`**, both CURRENCY, which
 *   is an INTEGER MINOR-UNIT amount. The provider sends a decimal
 *   (`{"currency":"usd","amount":16.54}`) and the mapping layer has no transform
 *   hook, so the connector server multiplies before it emits. Writing the
 *   decimal through unconverted would store 16 cents for a $16.54 label.
 * - **`shipment_insurance_claim`**, TEXT, forward-looking: null on all 50 probed
 *   labels because nothing on this account is insured, so its wire shape is
 *   still unknown.
 * - **`shipment_label_url`**, URL, the printable PDF of the live label. The
 *   value is a CAPABILITY URL: it fetches unauthenticated and carries a
 *   customer's name and address, so it is a bearer secret wherever it is read.
 *
 * All four are nullable and all four are label-level, so only the live
 * (non-voided) label's values ever arrive. That is correct rather than lossy:
 * voiding refunds the label.
 *
 * ## No backfill, and there is nothing to backfill
 *
 * Nothing has ever written these, because the fields did not exist. Null
 * everywhere is the correct starting state, and the values arrive on the next
 * sync after the connector's phase-2 mapping ships.
 *
 * ## Ordering
 *
 * MUST sort after 149, which creates the `shipment` def. An org short of it is a
 * SKIP rather than a failure: the seeder creates the def and all of these fields
 * together from the registry.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only and skips whatever the org
 * already holds, so a re-run writes nothing and reports `alreadyUpToDate`. Safe
 * to re-apply with `packages/lib/scripts/run-entity-migration.ts --id
 * 151-shipment-label-cost-and-document`.
 */
export const migration151ShipmentLabelCostAndDocument: PerOrgMigration = {
  id: '151-shipment-label-cost-and-document',
  description:
    'Adds the label cost, insurance cost, insurance claim and label PDF URL fields to the ' +
    'shipment def - both amounts in integer minor units because the provider sends decimals, ' +
    'and the URL is a bearer secret (shipstation-status-and-linking-plan.md §7)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const shipmentDef = existing.entityDefs.get(SHIPMENT_ENTITY_TYPE)
    if (!shipmentDef) {
      // The org never got migration 149's `shipment` def. A fresh install brings
      // the def and these four fields along together from the registry.
      return { ...state, alreadyUpToDate: true }
    }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = SHIPMENT_FIELDS[key]
      if (!field) {
        throw new Error(`shipment-fields registry is missing the key "${key}" (migration 151)`)
      }
      fields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      SHIPMENT_ENTITY_TYPE,
      shipmentDef.id,
      fields,
      existing,
      state
    )

    const changed = state.fieldsCreated > 0

    if (changed) {
      // `ensureCustomFields` bypasses the org cache and `UnifiedCrudHandler`
      // resolves a field's shape from it, so a stale entry would keep dropping
      // every write to these four. `perOrgMigration` flushes after the whole
      // batch, but `up()` is also called directly by
      // `scripts/run-entity-migration.ts`, so do it here too (as 148 does).
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 151 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
