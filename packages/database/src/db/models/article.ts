// packages/database/src/db/models/article.ts
// Article model built on BaseModel (org-scoped)

import { Article } from '../schema/article'
import { BaseModel } from '../utils/base-model'

/** Selected Article entity type */
export type ArticleEntity = typeof Article.$inferSelect
/** Insertable Article input type */
export type CreateArticleInput = typeof Article.$inferInsert
/** Updatable Article input type */
export type UpdateArticleInput = Partial<CreateArticleInput>

/**
 * ArticleModel encapsulates CRUD for the Article table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ArticleModel extends BaseModel<
  typeof Article,
  CreateArticleInput,
  ArticleEntity,
  UpdateArticleInput
> {
  /** Drizzle table */
  get table() {
    return Article
  }
}
