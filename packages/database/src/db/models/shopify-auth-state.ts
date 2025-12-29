// packages/database/src/db/models/shopify-auth-state.ts
// ShopifyAuthState model built on BaseModel (org-scoped)

import { ShopifyAuthState } from '../schema/shopify-auth-state'
import { BaseModel } from '../utils/base-model'

/** Selected ShopifyAuthState entity type */
export type ShopifyAuthStateEntity = typeof ShopifyAuthState.$inferSelect
/** Insertable ShopifyAuthState input type */
export type CreateShopifyAuthStateInput = typeof ShopifyAuthState.$inferInsert
/** Updatable ShopifyAuthState input type */
export type UpdateShopifyAuthStateInput = Partial<CreateShopifyAuthStateInput>

/**
 * ShopifyAuthStateModel encapsulates CRUD for the ShopifyAuthState table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ShopifyAuthStateModel extends BaseModel<
  typeof ShopifyAuthState,
  CreateShopifyAuthStateInput,
  ShopifyAuthStateEntity,
  UpdateShopifyAuthStateInput
> {
  /** Drizzle table */
  get table() {
    return ShopifyAuthState
  }
}
