// packages/database/src/db/models/order.ts
// Order model built on BaseModel (org-scoped)

import { Order } from '../schema/order'
import { BaseModel } from '../utils/base-model'

/** Selected Order entity type */
export type OrderEntity = typeof Order.$inferSelect
/** Insertable Order input type */
export type CreateOrderInput = typeof Order.$inferInsert
/** Updatable Order input type */
export type UpdateOrderInput = Partial<CreateOrderInput>

/**
 * OrderModel encapsulates CRUD for the Order table.
 * Org-scoped via organizationId when provided to the constructor.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class OrderModel extends BaseModel<
  typeof Order,
  CreateOrderInput,
  OrderEntity,
  UpdateOrderInput
> {
  /** Drizzle table */
  get table() {
    return Order
  }
}
