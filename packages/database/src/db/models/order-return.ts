// packages/database/src/db/models/order-return.ts
// OrderReturn model built on BaseModel (no org scope column)

import { OrderReturn } from '../schema/order-return'
import { BaseModel } from '../utils/base-model'

/** Selected OrderReturn entity type */
export type OrderReturnEntity = typeof OrderReturn.$inferSelect
/** Insertable OrderReturn input type */
export type CreateOrderReturnInput = typeof OrderReturn.$inferInsert
/** Updatable OrderReturn input type */
export type UpdateOrderReturnInput = Partial<CreateOrderReturnInput>

/**
 * OrderReturnModel encapsulates CRUD for the OrderReturn table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class OrderReturnModel extends BaseModel<
  typeof OrderReturn,
  CreateOrderReturnInput,
  OrderReturnEntity,
  UpdateOrderReturnInput
> {
  /** Drizzle table */
  get table() {
    return OrderReturn
  }
}
