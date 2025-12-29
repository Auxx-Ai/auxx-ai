// packages/database/src/db/models/product-option.ts
// ProductOption model built on BaseModel (no org scope column)

import { ProductOption } from '../schema/product-option'
import { BaseModel } from '../utils/base-model'

/** Selected ProductOption entity type */
export type ProductOptionEntity = typeof ProductOption.$inferSelect
/** Insertable ProductOption input type */
export type CreateProductOptionInput = typeof ProductOption.$inferInsert
/** Updatable ProductOption input type */
export type UpdateProductOptionInput = Partial<CreateProductOptionInput>

/**
 * ProductOptionModel encapsulates CRUD for the ProductOption table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class ProductOptionModel extends BaseModel<
  typeof ProductOption,
  CreateProductOptionInput,
  ProductOptionEntity,
  UpdateProductOptionInput
> {
  /** Drizzle table */
  get table() {
    return ProductOption
  }
}
