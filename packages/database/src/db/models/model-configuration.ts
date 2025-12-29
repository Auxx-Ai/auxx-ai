// packages/database/src/db/models/model-configuration.ts
// ModelConfiguration model built on BaseModel (org-scoped)

import { and, eq, type SQL } from 'drizzle-orm'
import { ModelConfiguration } from '../schema/model-configuration'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected ModelConfiguration entity type */
export type ModelConfigurationEntity = typeof ModelConfiguration.$inferSelect
/** Insertable ModelConfiguration input type */
export type CreateModelConfigurationInput = typeof ModelConfiguration.$inferInsert
/** Updatable ModelConfiguration input type */
export type UpdateModelConfigurationInput = Partial<CreateModelConfigurationInput>

/**
 * ModelConfigurationModel encapsulates CRUD for the ModelConfiguration table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ModelConfigurationModel extends BaseModel<
  typeof ModelConfiguration,
  CreateModelConfigurationInput,
  ModelConfigurationEntity,
  UpdateModelConfigurationInput
> {
  /** Drizzle table */
  get table() {
    return ModelConfiguration
  }

  async findByComposite(input: {
    provider: string
    model: string
    modelType: string
  }): Promise<TypedResult<ModelConfigurationEntity | null, Error>> {
    try {
      this.requireOrgIfScoped()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(ModelConfiguration.provider, input.provider))
      whereParts.push(eq(ModelConfiguration.model, input.model))
      whereParts.push(eq(ModelConfiguration.modelType, input.modelType as any))
      let q = this.db.select().from(ModelConfiguration).limit(1).$dynamic()
      if (whereParts.length) q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok((rows?.[0] as ModelConfigurationEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
