// packages/database/src/db/models/order-fulfillment.ts
// OrderFulfillment model built on BaseModel (no org scope column)

import { OrderFulfillment } from '../schema/order-fulfillment'
import { BaseModel } from '../utils/base-model'

/** Selected OrderFulfillment entity type */
export type OrderFulfillmentEntity = typeof OrderFulfillment.$inferSelect
/** Insertable OrderFulfillment input type */
export type CreateOrderFulfillmentInput = typeof OrderFulfillment.$inferInsert
/** Updatable OrderFulfillment input type */
export type UpdateOrderFulfillmentInput = Partial<CreateOrderFulfillmentInput>

/**
 * OrderFulfillmentModel encapsulates CRUD for the OrderFulfillment table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class OrderFulfillmentModel extends BaseModel<
  typeof OrderFulfillment,
  CreateOrderFulfillmentInput,
  OrderFulfillmentEntity,
  UpdateOrderFulfillmentInput
> {
  /** Drizzle table */
  get table() {
    return OrderFulfillment
  }
}
