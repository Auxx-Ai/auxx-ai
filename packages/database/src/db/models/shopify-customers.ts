// packages/database/src/db/models/shopify-customers.ts
// shopify_customers model built on BaseModel (org-scoped)

import { shopify_customers } from '../schema/shopify-customers'
import { BaseModel } from '../utils/base-model'

/** Selected shopify_customers entity type */
export type shopify_customersEntity = typeof shopify_customers.$inferSelect
/** Insertable shopify_customers input type */
export type Createshopify_customersInput = typeof shopify_customers.$inferInsert
/** Updatable shopify_customers input type */
export type Updateshopify_customersInput = Partial<Createshopify_customersInput>

/**
 * shopify_customersModel encapsulates CRUD for the shopify_customers table.
 * Org-scoped via organizationId when provided to the constructor.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class shopify_customersModel extends BaseModel<
  typeof shopify_customers,
  Createshopify_customersInput,
  shopify_customersEntity,
  Updateshopify_customersInput
> {
  /** Drizzle table */
  get table() {
    return shopify_customers
  }
}
