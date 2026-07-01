// packages/database/src/db/schema/inventory-bridge-link.ts
// Drizzle table: InventoryBridgeLink — per-link watermark for the v9 inventory→part
// consumption bridge. One row per linked variant record: it stores the last synced
// quantity (`lastSeenQuantity`) so the post-sync watermark pass can derive the
// consumption delta with CAS semantics, plus the per-link apply mode.
// See plans/data-connectors/v9/shopify-inventory-part-bridge-plan.md (Piece B2/C).

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { DataConnector } from './data-connector'
import { EntityDefinition } from './entity-definition'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

export const InventoryBridgeLink = pgTable(
  'InventoryBridgeLink',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    // The connector that syncs the inventory source. Denormalized so the pass can
    // filter links to the connector that just finished, and so connector deletion
    // cascades the watermark rows away.
    dataConnectorId: text()
      .notNull()
      .references((): AnyPgColumn => DataConnector.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    // The inventory-source entity def (e.g. shopify_variants). Matches an INVENTORY_BRIDGE
    // config entry's `sourceDefId`, so the pass scopes each link to the right entry's
    // quantity/relationship fields even when several sources are configured.
    sourceDefId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    // The inventory-source record (e.g. a shopify_variants instance). Unique — one
    // watermark per variant. Deleting the instance removes the link.
    variantInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    // The linked `part` instance the deltas deduct from. Denormalized for the pass;
    // the relationship field on the record stays the source of truth (a divergence
    // means the user re-pointed the link — the pass re-baselines).
    partInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    // The last synced quantity this link has accounted for. The CAS cursor: a
    // downward move emits a `sale` movement of the difference and advances this.
    lastSeenQuantity: integer().notNull(),
    // Per-link apply mode. `confirm` (default, safe) surfaces a review item; `auto`
    // creates the stock movement immediately.
    mode: text().$type<'auto' | 'confirm'>().default('confirm').notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
  },
  (table) => [
    // One watermark per inventory-source record.
    uniqueIndex('InventoryBridgeLink_variantInstanceId_key').using(
      'btree',
      table.variantInstanceId.asc().nullsLast()
    ),
    // The pass reads all links for the connector that just finished.
    index('InventoryBridgeLink_dataConnectorId_idx').using(
      'btree',
      table.dataConnectorId.asc().nullsLast()
    ),
    index('InventoryBridgeLink_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    // Cleanup + reverse lookups by the linked part.
    index('InventoryBridgeLink_partInstanceId_idx').using(
      'btree',
      table.partInstanceId.asc().nullsLast()
    ),
  ]
)

/** Selected InventoryBridgeLink entity type */
export type InventoryBridgeLinkEntity = typeof InventoryBridgeLink.$inferSelect
