// packages/database/src/db/models/shopify-integration.ts
// ShopifyIntegration model built on BaseModel (org-scoped)

import { and, eq, type SQL } from 'drizzle-orm'
import { ShopifyIntegration } from '../schema/shopify-integration'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected ShopifyIntegration entity type */
export type ShopifyIntegrationEntity = typeof ShopifyIntegration.$inferSelect
/** Insertable ShopifyIntegration input type */
export type CreateShopifyIntegrationInput = typeof ShopifyIntegration.$inferInsert
/** Updatable ShopifyIntegration input type */
export type UpdateShopifyIntegrationInput = Partial<CreateShopifyIntegrationInput>

/**
 * ShopifyIntegrationModel encapsulates CRUD for the ShopifyIntegration table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ShopifyIntegrationModel extends BaseModel<
  typeof ShopifyIntegration,
  CreateShopifyIntegrationInput,
  ShopifyIntegrationEntity,
  UpdateShopifyIntegrationInput
> {
  /** Drizzle table */
  get table() {
    return ShopifyIntegration
  }

  /** Find the first enabled integration within current org */
  async findEnabled(): Promise<TypedResult<ShopifyIntegrationEntity | null, Error>> {
    try {
      this.requireOrgIfScoped()

      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(ShopifyIntegration.enabled, true))

      let q = this.db.select().from(ShopifyIntegration).limit(1).$dynamic()
      if (whereParts.length) q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok((rows?.[0] as ShopifyIntegrationEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Global lookup by id without org scoping */
  async findByIdGlobal(id: string): Promise<TypedResult<ShopifyIntegrationEntity | null, Error>> {
    try {
      const rows = await this.db
        .select()
        .from(ShopifyIntegration)
        .where(eq(ShopifyIntegration.id, id))
        .limit(1)
      return Result.ok((rows?.[0] as ShopifyIntegrationEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
