// packages/database/src/db/models/inventory.ts
// Inventory model built on BaseModel (org-scoped)

import { Inventory } from '../schema/inventory'
import { BaseModel } from '../utils/base-model'

/** Selected Inventory entity type */
export type InventoryEntity = typeof Inventory.$inferSelect
/** Insertable Inventory input type */
export type CreateInventoryInput = typeof Inventory.$inferInsert
/** Updatable Inventory input type */
export type UpdateInventoryInput = Partial<CreateInventoryInput>

/**
 * InventoryModel encapsulates CRUD for the Inventory table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class InventoryModel extends BaseModel<
  typeof Inventory,
  CreateInventoryInput,
  InventoryEntity,
  UpdateInventoryInput
> {
  /** Drizzle table */
  get table() {
    return Inventory
  }
}
