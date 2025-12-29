// packages/database/src/db/models/snippet-folder.ts
// SnippetFolder model built on BaseModel (org-scoped)

import { SnippetFolder } from '../schema/snippet-folder'
import { BaseModel } from '../utils/base-model'

/** Selected SnippetFolder entity type */
export type SnippetFolderEntity = typeof SnippetFolder.$inferSelect
/** Insertable SnippetFolder input type */
export type CreateSnippetFolderInput = typeof SnippetFolder.$inferInsert
/** Updatable SnippetFolder input type */
export type UpdateSnippetFolderInput = Partial<CreateSnippetFolderInput>

/**
 * SnippetFolderModel encapsulates CRUD for the SnippetFolder table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class SnippetFolderModel extends BaseModel<
  typeof SnippetFolder,
  CreateSnippetFolderInput,
  SnippetFolderEntity,
  UpdateSnippetFolderInput
> {
  /** Drizzle table */
  get table() {
    return SnippetFolder
  }
}
