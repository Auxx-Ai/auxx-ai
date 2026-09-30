// packages/database/src/db/schema/inventory-movement-fact.ts
// A derived, rebuildable mirror of `StockMovement` for charts and usage; never read by QoH, costing or the GL. See plans/mrp/02-data-structures.md §3.

import { type AnyPgColumn, index, numeric, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'
import { inventoryConsumptionClass } from './stock-movement'

export const InventoryMovementFact = pgTable(
  'InventoryMovementFact',
  {
    /** The `StockMovement` id. 1:1, so the insert is idempotent; no FK, the movements seam deletes it. */
    id: text().primaryKey().notNull(),
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
