// packages/database/src/db/models/api-key.ts
// ApiKey model built on BaseModel (org-scoped)

import { and, eq, type SQL } from 'drizzle-orm'
import { ApiKey } from '../schema/api-key'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected ApiKey entity type */
export type ApiKeyEntity = typeof ApiKey.$inferSelect
/** Insertable ApiKey input type */
export type CreateApiKeyInput = typeof ApiKey.$inferInsert
/** Updatable ApiKey input type */
export type UpdateApiKeyInput = Partial<CreateApiKeyInput>

/**
 * ApiKeyModel encapsulates CRUD for the ApiKey table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ApiKeyModel extends BaseModel<
  typeof ApiKey,
  CreateApiKeyInput,
  ApiKeyEntity,
  UpdateApiKeyInput
> {
  /** Drizzle table */
  get table() {
    return ApiKey
  }

  /** List active API keys for a user */
  async listActiveByUser(userId: string): Promise<TypedResult<ApiKeyEntity[], Error>> {
    try {
      const whereParts: SQL<unknown>[] = [eq(ApiKey.userId, userId), eq(ApiKey.isActive, true)]
      if (this.scopeFilter) whereParts.unshift(this.scopeFilter)
      let q = this.db.select().from(ApiKey).$dynamic()
      if (whereParts.length === 1) q = q.where(whereParts[0])
      else q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok(rows as ApiKeyEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Find API key by name for a user (if named) */
  async findByNameForUser(userId: string, name?: string | null): Promise<TypedResult<ApiKeyEntity | null, Error>> {
    try {
      if (!name) return Result.ok(null)
      const whereParts: SQL<unknown>[] = [eq(ApiKey.userId, userId), eq(ApiKey.name, name as any)]
      if (this.scopeFilter) whereParts.unshift(this.scopeFilter)
      let q = this.db.select().from(ApiKey).limit(1).$dynamic()
      q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok((rows?.[0] as ApiKeyEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** List active API keys for a workflow (workflow-scoped keys) */
  async listActiveByWorkflow(workflowAppId: string): Promise<TypedResult<ApiKeyEntity[], Error>> {
    try {
      const whereParts: SQL<unknown>[] = [
        eq(ApiKey.type, 'workflow'),
        eq(ApiKey.referenceId, workflowAppId),
        eq(ApiKey.isActive, true),
      ]
      if (this.scopeFilter) whereParts.unshift(this.scopeFilter)

      let q = this.db.select().from(ApiKey).$dynamic()
      q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok(rows as ApiKeyEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
