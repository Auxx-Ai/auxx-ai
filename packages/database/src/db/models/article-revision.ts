// packages/database/src/db/models/article-revision.ts
// ArticleRevision model built on BaseModel (org-scoped)

import { ArticleRevision } from '../schema/article-revision'
import { BaseModel } from '../utils/base-model'

/** Selected ArticleRevision entity type */
export type ArticleRevisionEntity = typeof ArticleRevision.$inferSelect
/** Insertable ArticleRevision input type */
export type CreateArticleRevisionInput = typeof ArticleRevision.$inferInsert
/** Updatable ArticleRevision input type */
export type UpdateArticleRevisionInput = Partial<CreateArticleRevisionInput>

/**
 * ArticleRevisionModel encapsulates CRUD for the ArticleRevision table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ArticleRevisionModel extends BaseModel<
  typeof ArticleRevision,
  CreateArticleRevisionInput,
  ArticleRevisionEntity,
  UpdateArticleRevisionInput
> {
  /** Drizzle table */
  get table() {
    return ArticleRevision
  }
}
