// packages/database/src/db/models/article-tag.ts
// ArticleTag model built on BaseModel (org-scoped)

import { ArticleTag } from '../schema/article-tag'
import { BaseModel } from '../utils/base-model'

/** Selected ArticleTag entity type */
export type ArticleTagEntity = typeof ArticleTag.$inferSelect
/** Insertable ArticleTag input type */
export type CreateArticleTagInput = typeof ArticleTag.$inferInsert
/** Updatable ArticleTag input type */
export type UpdateArticleTagInput = Partial<CreateArticleTagInput>

/**
 * ArticleTagModel encapsulates CRUD for the ArticleTag table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ArticleTagModel extends BaseModel<
  typeof ArticleTag,
  CreateArticleTagInput,
  ArticleTagEntity,
  UpdateArticleTagInput
> {
  /** Drizzle table */
  get table() {
    return ArticleTag
  }
}
