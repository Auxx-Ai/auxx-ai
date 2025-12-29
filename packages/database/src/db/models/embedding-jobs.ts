// packages/database/src/db/models/embedding-jobs.ts
// embedding_jobs model built on BaseModel (org-scoped)

import { embedding_jobs } from '../schema/embedding-jobs'
import { BaseModel } from '../utils/base-model'

/** Selected embedding_jobs entity type */
export type embedding_jobsEntity = typeof embedding_jobs.$inferSelect
/** Insertable embedding_jobs input type */
export type Createembedding_jobsInput = typeof embedding_jobs.$inferInsert
/** Updatable embedding_jobs input type */
export type Updateembedding_jobsInput = Partial<Createembedding_jobsInput>

/**
 * embedding_jobsModel encapsulates CRUD for the embedding_jobs table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class embedding_jobsModel extends BaseModel<
  typeof embedding_jobs,
  Createembedding_jobsInput,
  embedding_jobsEntity,
  Updateembedding_jobsInput
> {
  /** Drizzle table */
  get table() {
    return embedding_jobs
  }
}
