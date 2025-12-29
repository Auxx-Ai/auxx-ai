// packages/database/src/db/models/fulfillment-tracking.ts
// FulfillmentTracking model built on BaseModel (no org scope column)

import { FulfillmentTracking } from '../schema/fulfillment-tracking'
import { BaseModel } from '../utils/base-model'

/** Selected FulfillmentTracking entity type */
export type FulfillmentTrackingEntity = typeof FulfillmentTracking.$inferSelect
/** Insertable FulfillmentTracking input type */
export type CreateFulfillmentTrackingInput = typeof FulfillmentTracking.$inferInsert
/** Updatable FulfillmentTracking input type */
export type UpdateFulfillmentTrackingInput = Partial<CreateFulfillmentTrackingInput>

/**
 * FulfillmentTrackingModel encapsulates CRUD for the FulfillmentTracking table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class FulfillmentTrackingModel extends BaseModel<
  typeof FulfillmentTracking,
  CreateFulfillmentTrackingInput,
  FulfillmentTrackingEntity,
  UpdateFulfillmentTrackingInput
> {
  /** Drizzle table */
  get table() {
    return FulfillmentTracking
  }
}
