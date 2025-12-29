// packages/database/src/db/models/product.ts
// Product model built on BaseModel (org-scoped)

import { Product } from '../schema/product'
import { BaseModel } from '../utils/base-model'

/** Selected Product entity type */
export type ProductEntity = typeof Product.$inferSelect
/** Insertable Product input type */
export type CreateProductInput = typeof Product.$inferInsert
/** Updatable Product input type */
export type UpdateProductInput = Partial<CreateProductInput>

/**
 * ProductModel encapsulates CRUD for the Product table.
 * Org-scoped via organizationId when provided to the constructor.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class ProductModel extends BaseModel<
  typeof Product,
  CreateProductInput,
  ProductEntity,
  UpdateProductInput
> {
  /** Drizzle table */
  get table() {
    return Product
  }
}
