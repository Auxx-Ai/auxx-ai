// packages/database/src/db/models/order-line-item.ts
// OrderLineItem model built on BaseModel (no org scope column)

import { OrderLineItem } from '../schema/order-line-item'
import { BaseModel } from '../utils/base-model'

/** Selected OrderLineItem entity type */
export type OrderLineItemEntity = typeof OrderLineItem.$inferSelect
/** Insertable OrderLineItem input type */
export type CreateOrderLineItemInput = typeof OrderLineItem.$inferInsert
/** Updatable OrderLineItem input type */
export type UpdateOrderLineItemInput = Partial<CreateOrderLineItemInput>

/**
 * OrderLineItemModel encapsulates CRUD for the OrderLineItem table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class OrderLineItemModel extends BaseModel<
  typeof OrderLineItem,
  CreateOrderLineItemInput,
  OrderLineItemEntity,
  UpdateOrderLineItemInput
> {
  /** Drizzle table */
  get table() {
    return OrderLineItem
  }
}
