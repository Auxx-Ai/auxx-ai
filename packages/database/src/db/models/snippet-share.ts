// packages/database/src/db/models/snippet-share.ts
// SnippetShare model built on BaseModel (no org scope column)

import { SnippetShare } from '../schema/snippet-share'
import { BaseModel } from '../utils/base-model'

/** Selected SnippetShare entity type */
export type SnippetShareEntity = typeof SnippetShare.$inferSelect
/** Insertable SnippetShare input type */
export type CreateSnippetShareInput = typeof SnippetShare.$inferInsert
/** Updatable SnippetShare input type */
export type UpdateSnippetShareInput = Partial<CreateSnippetShareInput>

/**
 * SnippetShareModel encapsulates CRUD for the SnippetShare table.
 * No org scoping is applied by default.
 */
export class SnippetShareModel extends BaseModel<
  typeof SnippetShare,
  CreateSnippetShareInput,
  SnippetShareEntity,
  UpdateSnippetShareInput
> {
  /** Drizzle table */
  get table() {
    return SnippetShare
  }
}
