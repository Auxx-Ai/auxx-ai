// packages/database/src/db/models/product-variant.ts
// ProductVariant model built on BaseModel (org-scoped)

import { ProductVariant } from '../schema/product-variant'
import { BaseModel } from '../utils/base-model'

/** Selected ProductVariant entity type */
export type ProductVariantEntity = typeof ProductVariant.$inferSelect
/** Insertable ProductVariant input type */
export type CreateProductVariantInput = typeof ProductVariant.$inferInsert
/** Updatable ProductVariant input type */
export type UpdateProductVariantInput = Partial<CreateProductVariantInput>

/**
 * ProductVariantModel encapsulates CRUD for the ProductVariant table.
 * Org-scoped via organizationId when provided to the constructor.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class ProductVariantModel extends BaseModel<
  typeof ProductVariant,
  CreateProductVariantInput,
  ProductVariantEntity,
  UpdateProductVariantInput
> {
  /** Drizzle table */
  get table() {
    return ProductVariant
  }
}
