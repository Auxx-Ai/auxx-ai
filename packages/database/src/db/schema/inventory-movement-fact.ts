// packages/database/src/db/schema/inventory-movement-fact.ts
// A derived, rebuildable mirror of `stock_movement` for charts and usage; never read by QoH, costing or the GL. See plans/mrp/02-data-structures.md §3.

import { type AnyPgColumn, index, numeric, pgEnum, pgTable, text, timestamp } from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

/** How a movement counts for planning (plans/mrp/01-consumption-from-the-ledger.md §2). */
export const inventoryConsumptionClass = pgEnum('InventoryConsumptionClass', [
  'consumption', // sale, ship, build_consume
  'scrap', // consumption, reported separately
  'supply', // receive, build_produce, initial, salvage return_in, return_out
  'adjustment', // adjust, and children of an exploded adjustment
  'none', // revalue (quantity 0)
])

export const InventoryMovementFact = pgTable(
  'InventoryMovementFact',
  {
    /** The `stock_movement` EntityInstance id. 1:1, so the insert is idempotent; the cascade is the delete door. */
    id: text()
      .primaryKey()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Entity record ids below carry no FK, as on `GlPosting.railId`. */
    partId: text().notNull(),
    /** A `StockMovementType` value. */
    type: text().notNull(),
    /** Signed. */
    quantity: numeric({ mode: 'number' }).notNull(),
    /** COALESCE(occurredAt, createdAt), resolved once at insert. */
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    consumptionClass: inventoryConsumptionClass().notNull(),
    /** Set on a reversal; its class is the ORIGINAL's class, with the sign negated by quantity. */
    reversesMovementId: text(),
    parentMovementId: text(),
    buildId: text(),
    fulfillmentLineId: text(),
    purchaseOrderLineId: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('InventoryMovementFact_org_part_occurred_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.partId.asc().nullsLast(),
      table.occurredAt.asc().nullsLast()
    ),
    index('InventoryMovementFact_org_occurred_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.occurredAt.asc().nullsLast()
    ),
    index('InventoryMovementFact_po_line_idx').using(
      'btree',
      table.purchaseOrderLineId.asc().nullsLast()
    ),
  ]
)
