// packages/database/src/db/models/external-knowledge-source.ts
// ExternalKnowledgeSource model built on BaseModel (org-scoped)

import { ExternalKnowledgeSource } from '../schema/external-knowledge-source'
import { BaseModel } from '../utils/base-model'

/** Selected ExternalKnowledgeSource entity type */
export type ExternalKnowledgeSourceEntity = typeof ExternalKnowledgeSource.$inferSelect
/** Insertable ExternalKnowledgeSource input type */
export type CreateExternalKnowledgeSourceInput = typeof ExternalKnowledgeSource.$inferInsert
/** Updatable ExternalKnowledgeSource input type */
export type UpdateExternalKnowledgeSourceInput = Partial<CreateExternalKnowledgeSourceInput>

/**
 * ExternalKnowledgeSourceModel encapsulates CRUD for the ExternalKnowledgeSource table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ExternalKnowledgeSourceModel extends BaseModel<
  typeof ExternalKnowledgeSource,
  CreateExternalKnowledgeSourceInput,
  ExternalKnowledgeSourceEntity,
  UpdateExternalKnowledgeSourceInput
> {
  /** Drizzle table */
  get table() {
    return ExternalKnowledgeSource
  }
}
