// packages/database/src/db/models/embeddings.ts
// embeddings model built on BaseModel (no org scope column)

import { embeddings } from '../schema/embeddings'
import { BaseModel } from '../utils/base-model'

/** Selected embeddings entity type */
export type embeddingsEntity = typeof embeddings.$inferSelect
/** Insertable embeddings input type */
export type CreateembeddingsInput = typeof embeddings.$inferInsert
/** Updatable embeddings input type */
export type UpdateembeddingsInput = Partial<CreateembeddingsInput>

/**
 * embeddingsModel encapsulates CRUD for the embeddings table.
 * No org scoping is applied by default.
 */
export class embeddingsModel extends BaseModel<
  typeof embeddings,
  CreateembeddingsInput,
  embeddingsEntity,
  UpdateembeddingsInput
> {
  /** Drizzle table */
  get table() {
    return embeddings
  }
}
