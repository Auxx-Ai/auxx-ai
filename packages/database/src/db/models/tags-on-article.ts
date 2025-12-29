// packages/database/src/db/models/tags-on-article.ts
// TagsOnArticle model built on BaseModel (no org scope column)

import { TagsOnArticle } from '../schema/tags-on-article'
import { BaseModel } from '../utils/base-model'

/** Selected TagsOnArticle entity type */
export type TagsOnArticleEntity = typeof TagsOnArticle.$inferSelect
/** Insertable TagsOnArticle input type */
export type CreateTagsOnArticleInput = typeof TagsOnArticle.$inferInsert
/** Updatable TagsOnArticle input type */
export type UpdateTagsOnArticleInput = Partial<CreateTagsOnArticleInput>

/**
 * TagsOnArticleModel encapsulates CRUD for the TagsOnArticle table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class TagsOnArticleModel extends BaseModel<
  typeof TagsOnArticle,
  CreateTagsOnArticleInput,
  TagsOnArticleEntity,
  UpdateTagsOnArticleInput
> {
  /** Drizzle table */
  get table() {
    return TagsOnArticle
  }
}
