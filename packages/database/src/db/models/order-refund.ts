// packages/database/src/db/models/order-refund.ts
// OrderRefund model built on BaseModel (no org scope column)

import { OrderRefund } from '../schema/order-refund'
import { BaseModel } from '../utils/base-model'

/** Selected OrderRefund entity type */
export type OrderRefundEntity = typeof OrderRefund.$inferSelect
/** Insertable OrderRefund input type */
export type CreateOrderRefundInput = typeof OrderRefund.$inferInsert
/** Updatable OrderRefund input type */
export type UpdateOrderRefundInput = Partial<CreateOrderRefundInput>

/**
 * OrderRefundModel encapsulates CRUD for the OrderRefund table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class OrderRefundModel extends BaseModel<
  typeof OrderRefund,
  CreateOrderRefundInput,
  OrderRefundEntity,
  UpdateOrderRefundInput
> {
  /** Drizzle table */
  get table() {
    return OrderRefund
  }
}
