// packages/database/src/db/models/knowledge-base.ts
// KnowledgeBase model built on BaseModel (org-scoped)

import { eq } from 'drizzle-orm'
import { KnowledgeBase } from '../schema/knowledge-base'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected KnowledgeBase entity type */
export type KnowledgeBaseEntity = typeof KnowledgeBase.$inferSelect
/** Insertable KnowledgeBase input type */
export type CreateKnowledgeBaseInput = typeof KnowledgeBase.$inferInsert
/** Updatable KnowledgeBase input type */
export type UpdateKnowledgeBaseInput = Partial<CreateKnowledgeBaseInput>

/**
 * KnowledgeBaseModel encapsulates CRUD for the KnowledgeBase table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class KnowledgeBaseModel extends BaseModel<
  typeof KnowledgeBase,
  CreateKnowledgeBaseInput,
  KnowledgeBaseEntity,
  UpdateKnowledgeBaseInput
> {
  /** Drizzle table */
  get table() {
    return KnowledgeBase
  }

  /**
   * Global lookup by id without org scoping (for preview/public use cases)
   */
  async findByIdGlobal(id: string): Promise<TypedResult<KnowledgeBaseEntity | null, Error>> {
    try {
      const rows = await this.db.select().from(KnowledgeBase).where(eq(KnowledgeBase.id, id)).limit(1)
      return Result.ok((rows?.[0] as KnowledgeBaseEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
