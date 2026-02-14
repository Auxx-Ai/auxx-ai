// packages/lib/src/ai/providers/system-model-service.ts

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { ModelType } from './types'

/**
 * Interface representing a system model default configuration
 */
export interface SystemModelDefaultEntity {
  id: string
  organizationId: string
  modelType: string
  provider: string
  model: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Service for managing system-wide default model preferences per organization.
 * These defaults are used when no specific model is provided for AI operations.
 */
export class SystemModelService {
  constructor(
    private db: Database,
    private organizationId: string
  ) {}

  /**
   * Get all system model defaults for the organization
   */
  async getAllDefaults(): Promise<SystemModelDefaultEntity[]> {
    const results = await this.db.query.SystemModelDefault.findMany({
      where: eq(schema.SystemModelDefault.organizationId, this.organizationId),
    })
    return results as SystemModelDefaultEntity[]
  }

  /**
   * Get system default model for a specific model type
   */
  async getDefault(modelType: ModelType): Promise<SystemModelDefaultEntity | null> {
    const result = await this.db.query.SystemModelDefault.findFirst({
      where: and(
        eq(schema.SystemModelDefault.organizationId, this.organizationId),
        eq(schema.SystemModelDefault.modelType, modelType)
      ),
    })
    return (result as SystemModelDefaultEntity) ?? null
  }

  /**
   * Set or update the system default model for a model type.
   * Uses upsert to either create a new record or update an existing one.
   */
  async setDefault(modelType: ModelType, provider: string, model: string): Promise<void> {
    const now = new Date()
    await this.db
      .insert(schema.SystemModelDefault)
      .values({
        organizationId: this.organizationId,
        modelType,
        provider,
        model,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.SystemModelDefault.organizationId, schema.SystemModelDefault.modelType],
        set: {
          provider,
          model,
          updatedAt: now,
        },
      })
  }

  /**
   * Remove a system default model for a model type
   */
  async removeDefault(modelType: ModelType): Promise<void> {
    await this.db
      .delete(schema.SystemModelDefault)
      .where(
        and(
          eq(schema.SystemModelDefault.organizationId, this.organizationId),
          eq(schema.SystemModelDefault.modelType, modelType)
        )
      )
  }
}
