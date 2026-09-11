// packages/lib/src/seed/entity-migrations/migrations/137-fulfillment-facts.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:137')

/** The def the three fulfillment facts land on. Created by migration 107. */
const LINE_ITEM_ENTITY_TYPE = 'line_item'

/** The registry keys this migration adds. Their attributes are in the JSDoc below. */
const LINE_ITEM_KEYS = ['fulfilledAt', 'fulfilledQty', 'shipmentCount'] as const

/**
 * Migration 137: the sales channel's per-line fulfillment rollup, natively.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §8.4 decision 4.
 *
 * ## What it adds
 *
 * - **`line_item_fulfilled_at`, `line_item_fulfilled_qty` and
 *   `line_item_shipment_count`** on `line_item`. Shopify already projects all
 *   three on every order sync, but until now they landed ONLY in
 *   `@app:shopify:*` app fields (49 §8.1 item 4), so **nothing native said an
 *   imported order had shipped** - and `money.fulfillOrder`, the one door into
 *   the ledger, was closed for 530 of the dev org's 545 orders (49 §1.2).
 *
 *   Native is the point, not a convenience. `deriveFulfillmentLog` (the sixth
 *   finalize pass) reconstructs `order_fulfillments` from these three fields and
 *   knows no Shopify field path at all, which is gap-f `G14`'s rule: the
 *   connector projects, lib reads native attributes. Measured on the dev org
 *   (49 §5): 82 of 538 imported orders ship in two shipments, no line spans two,
 *   and all 82 reconstruct by grouping lines on their fulfilled date.
 *
 * ## What it deliberately does NOT do
 *
 * 🛑 **No backfill of the three fields, and none is possible.** The values come
 * from the sales channel on the next sync after the connector bindings and the
 * org's mapping remap land, which is a change in a separate repo (49 §8.5). An
 * order that has already shipped carries no fulfilled date here until then, and
 * inventing one from `order_fulfillment_status` would date every shipment wrong
 * and post a year of revenue into one day.
 *
 * 🛑 **It no longer stamps a `clearing_affirm` role onto `1210`.** It did when
 * it landed, and that half was removed on 2026-09-10 along with the role and
 * both Affirm accounts: a role may not name a vendor, so Affirm became a
 * `payment_gateway` record the merchant adds (see `build-entry.ts`'s two rules
 * and `default-chart.ts`'s `card_rail` header). Editing this migration in place
 * rather than writing a compensating one is only safe because accounting has
 * never been deployed - an org that already ran the old 137 keeps an inert
 * `clearing_affirm` assignment row, which `listRoleMap` no longer lists and
 * `resolveRoles` is never asked for.
 *
 * ## Ordering
 *
 * MUST sort after 107, which creates `line_item`. An org without it is a skip,
 * not a failure - it picks the def up from the seeder with the rest of the
 * registry.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only and skips a field that
 * exists.
 */
export const migration137FulfillmentFacts: EntityMigration = {
  id: '137-fulfillment-facts',
  description:
    'Adds line_item_fulfilled_at, line_item_fulfilled_qty and line_item_shipment_count - the ' +
    "sales channel's per-line fulfillment rollup, carried natively so the fulfillment log " +
    'pass can reconstruct order_fulfillments for a connector order',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const lineItemDef = existing.entityDefs.get(LINE_ITEM_ENTITY_TYPE)
    if (lineItemDef) {
      await ensureCustomFields(
        db,
        organizationId,
        LINE_ITEM_ENTITY_TYPE,
        lineItemDef.id,
        pickLineItemFields(),
        existing,
        state
      )
    }

    const changed = state.fieldsCreated > 0

    if (changed) {
      // A new field is invisible to every read path that serves it until the
      // per-org caches are dropped. `runEntityMigrationsForOrg` does this after
      // the whole batch, but `up()` can also be called directly
      // (`scripts/run-entity-migration.ts`).
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
      logger.info('Migration 137 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * The three registry fields, loud if one was renamed.
 *
 * A silent skip here would ship a migration that reports success having created
 * nothing, and the pass that reads these attributes would then find no field and
 * derive no shipment log for any order - which reads as "this org has not synced
 * yet" rather than as a broken migration. The same guard 136's `pick` carries.
 */
function pickLineItemFields(): Record<string, ResourceField> {
  const picked: Record<string, ResourceField> = {}
  for (const key of LINE_ITEM_KEYS) {
    const field = LINE_ITEM_FIELDS[key]
    if (!field) {
      throw new Error(`line_item registry is missing the key "${key}" (migration 137)`)
    }
    picked[key] = field
  }
  return picked
}
