// packages/database/src/db/models/integration.ts
// Integration model (org-scoped) built on BaseModel

import { eq } from 'drizzle-orm'
import { Integration } from '../schema/integration'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'
import type { IntegrationProviderType } from '../../types'

/** Selected Integration entity type */
export type IntegrationEntity = typeof Integration.$inferSelect

/** Insertable Integration input type */
export type CreateIntegrationInput = typeof Integration.$inferInsert

/** Updatable Integration input type */
export type UpdateIntegrationInput = Partial<CreateIntegrationInput>

export class IntegrationModel extends BaseModel<
  typeof Integration,
  CreateIntegrationInput,
  IntegrationEntity,
  UpdateIntegrationInput
> {
  get table() {
    return Integration
  }

  async findByProvider(
    provider: IntegrationProviderType,
  ): Promise<TypedResult<IntegrationEntity[], Error>> {
    try {
      return this.findMany({ where: eq(Integration.provider, provider) })
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Global lookup by id without org scoping */
  async findByIdGlobal(id: string): Promise<TypedResult<IntegrationEntity | null, Error>> {
    try {
      const rows = await this.db.select().from(Integration).where(eq(Integration.id, id)).limit(1)
      return Result.ok((rows?.[0] as IntegrationEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
