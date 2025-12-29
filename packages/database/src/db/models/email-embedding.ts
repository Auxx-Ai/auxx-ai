// packages/database/src/db/models/email-embedding.ts
// EmailEmbedding model built on BaseModel (no org scope column)

import { EmailEmbedding } from '../schema/email-embedding'
import { BaseModel } from '../utils/base-model'

/** Selected EmailEmbedding entity type */
export type EmailEmbeddingEntity = typeof EmailEmbedding.$inferSelect
/** Insertable EmailEmbedding input type */
export type CreateEmailEmbeddingInput = typeof EmailEmbedding.$inferInsert
/** Updatable EmailEmbedding input type */
export type UpdateEmailEmbeddingInput = Partial<CreateEmailEmbeddingInput>

/**
 * EmailEmbeddingModel encapsulates CRUD for the EmailEmbedding table.
 * No org scoping is applied by default.
 */
export class EmailEmbeddingModel extends BaseModel<
  typeof EmailEmbedding,
  CreateEmailEmbeddingInput,
  EmailEmbeddingEntity,
  UpdateEmailEmbeddingInput
> {
  /** Drizzle table */
  get table() {
    return EmailEmbedding
  }
}
