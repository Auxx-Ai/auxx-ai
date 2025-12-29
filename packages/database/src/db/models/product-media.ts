// packages/database/src/db/models/product-media.ts
// ProductMedia model built on BaseModel (no org scope column)

import { ProductMedia } from '../schema/product-media'
import { BaseModel } from '../utils/base-model'

/** Selected ProductMedia entity type */
export type ProductMediaEntity = typeof ProductMedia.$inferSelect
/** Insertable ProductMedia input type */
export type CreateProductMediaInput = typeof ProductMedia.$inferInsert
/** Updatable ProductMedia input type */
export type UpdateProductMediaInput = Partial<CreateProductMediaInput>

/**
 * ProductMediaModel encapsulates CRUD for the ProductMedia table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class ProductMediaModel extends BaseModel<
  typeof ProductMedia,
  CreateProductMediaInput,
  ProductMediaEntity,
  UpdateProductMediaInput
> {
  /** Drizzle table */
  get table() {
    return ProductMedia
  }
}
