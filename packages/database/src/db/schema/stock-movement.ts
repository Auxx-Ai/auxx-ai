// packages/database/src/db/schema/stock-movement.ts
// The inventory ledger: one row per stock movement, append-only. See plans/mrp/20-stock-movement-table.md §3.

import { createId } from '@paralleldrive/cuid2'
import {
  StockMovementConsumptionClassValues,
  StockMovementCostBasisValues,
  StockMovementTypeValues,
} from '../../enums'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

export const stockMovementType = pgEnum('StockMovementType', StockMovementTypeValues)
export const stockMovementCostBasis = pgEnum('StockMovementCostBasis', StockMovementCostBasisValues)
/** The pg type name predates this table; kept so no new type is made. */
export const inventoryConsumptionClass = pgEnum(
  'InventoryConsumptionClass',
  StockMovementConsumptionClassValues
)

// Parent links are `no action`, not cascade: the lib seam deletes movements so QoH and roll-ups on
// surviving parts are recomputed (plan §2 S9). Each FK column has an index leading with it, because
// every EntityInstance delete runs the FK check against this table.
export const StockMovement = pgTable(
  'StockMovement',
  {
    /** Kept equal to the old `stock_movement` EntityInstance id, so GL sources still resolve. */
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    partId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, { onUpdate: 'cascade' }),
    type: stockMovementType().notNull(),
    /** Signed. */
    quantity: numeric({ precision: 20, scale: 6, mode: 'number' }).notNull(),
    reason: text(),
    reference: text(),
    /** A row still waiting for its BOM explosion; the on-hand SUM excludes it. */
    adjustSubparts: boolean().default(false).notNull(),
    parentMovementId: text().references((): AnyPgColumn => StockMovement.id, {
      onUpdate: 'cascade',
    }),
    /** Minor units per unit, up to 3 fractional cents. Null exactly when `costBasis` is `pending`. */
    unitCostMinor: numeric({ precision: 20, scale: 3, mode: 'number' }),
    /** Signed like `quantity`. */
    extendedCostMinor: bigint({ mode: 'number' }),
    costBasis: stockMovementCostBasis(),
    /** An inventory account ROLE (decision G8), never a code. */
    glRole: text(),
    occurredAt: timestamp({ precision: 3, withTimezone: true }),
    vendorPartId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    vendorUnitPriceMinor: numeric({ precision: 20, scale: 3, mode: 'number' }),
    freightAccruedMinor: bigint({ mode: 'number' }),
    dutiesAccruedMinor: bigint({ mode: 'number' }),
    /** A percentage: `25` means 25%. */
    tariffRate: numeric({ precision: 12, scale: 6, mode: 'number' }),
    purchaseOrderLineId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
    }),
    reversesMovementId: text().references((): AnyPgColumn => StockMovement.id, {
      onUpdate: 'cascade',
    }),
    /** A `Build.id`. No FK: the schema migration runs before the build reset clears old ids (mrp 23). */
    buildId: text(),
    /** The as-built BOM quantity; null is the off-BOM marker. */
    qtyPerUnit: numeric({ precision: 20, scale: 6, mode: 'number' }),
    fulfillmentLineId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
    }),
    returnPartLineId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** The count an `initial` anchor is derived from (111 Q26). */
    countQuantity: numeric({ precision: 20, scale: 6, mode: 'number' }),
    /** Book-zone calendar day of the count. */
    countDate: date({ mode: 'string' }),
    /** Planning class; a reversal carries its original's. Null until backfill 203. */
    consumptionClass: inventoryConsumptionClass(),
    createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** The ledger's ordering; every dated read filters and sorts on it. */
    effectiveAt: timestamp({ precision: 3, withTimezone: true })
      .notNull()
      .generatedAlwaysAs(sql`COALESCE("occurredAt", "createdAt")`),
  },
  (table) => [
    index('StockMovement_part_effectiveAt_idx').using(
      'btree',
      table.partId.asc().nullsLast(),
      table.effectiveAt.asc().nullsLast()
    ),
    index('StockMovement_org_effectiveAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.effectiveAt.asc().nullsLast()
    ),
    index('StockMovement_buildId_idx')
      .using('btree', table.buildId.asc().nullsLast())
      .where(sql`"buildId" IS NOT NULL`),
    index('StockMovement_purchaseOrderLineId_idx')
      .using('btree', table.purchaseOrderLineId.asc().nullsLast())
      .where(sql`"purchaseOrderLineId" IS NOT NULL`),
    index('StockMovement_fulfillmentLineId_idx')
      .using('btree', table.fulfillmentLineId.asc().nullsLast())
      .where(sql`"fulfillmentLineId" IS NOT NULL`),
    index('StockMovement_vendorPartId_idx')
      .using('btree', table.vendorPartId.asc().nullsLast())
      .where(sql`"vendorPartId" IS NOT NULL`),
    index('StockMovement_returnPartLineId_idx')
      .using('btree', table.returnPartLineId.asc().nullsLast())
      .where(sql`"returnPartLineId" IS NOT NULL`),
    index('StockMovement_parentMovementId_idx')
      .using('btree', table.parentMovementId.asc().nullsLast())
      .where(sql`"parentMovementId" IS NOT NULL`),
    index('StockMovement_org_pending_idx')
      .using('btree', table.organizationId.asc().nullsLast(), table.partId.asc().nullsLast())
      .where(sql`"costBasis" = 'pending'`),
    // A movement is reversed at most once.
    uniqueIndex('StockMovement_reversesMovementId_key')
      .using('btree', table.reversesMovementId.asc().nullsLast())
      .where(sql`"reversesMovementId" IS NOT NULL`),

    // A null costBasis (pre-cost-basis rows, BOM children) is unconstrained.
    check(
      'StockMovement_pending_cost_check',
      sql`("costBasis" = 'pending') = ("unitCostMinor" IS NULL)`
    ),
    check(
      'StockMovement_pending_extended_check',
      sql`"costBasis" <> 'pending' OR "extendedCostMinor" IS NULL`
    ),
    check('StockMovement_quantity_check', sql`"quantity" <> 0 OR "type" = 'revalue'`),
  ]
)

export type StockMovementEntity = typeof StockMovement.$inferSelect
export type CreateStockMovementInput = typeof StockMovement.$inferInsert
