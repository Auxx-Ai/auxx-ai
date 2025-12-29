// packages/database/src/db/models/tags-on-thread.ts
// TagsOnThread model built on BaseModel (no org scope column)

import { TagsOnThread } from '../schema/tags-on-thread'
import { BaseModel } from '../utils/base-model'

/** Selected TagsOnThread entity type */
export type TagsOnThreadEntity = typeof TagsOnThread.$inferSelect
/** Insertable TagsOnThread input type */
export type CreateTagsOnThreadInput = typeof TagsOnThread.$inferInsert
/** Updatable TagsOnThread input type */
export type UpdateTagsOnThreadInput = Partial<CreateTagsOnThreadInput>

/**
 * TagsOnThreadModel encapsulates CRUD for the TagsOnThread table.
 * No org scoping is applied by default.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class TagsOnThreadModel extends BaseModel<
  typeof TagsOnThread,
  CreateTagsOnThreadInput,
  TagsOnThreadEntity,
  UpdateTagsOnThreadInput
> {
  /** Drizzle table */
  get table() {
    return TagsOnThread
  }
}
