// packages/database/src/db/models/folder.ts
// Folder model built on BaseModel (org-scoped)

import { Folder } from '../schema/folder'
import { BaseModel } from '../utils/base-model'

/** Selected Folder entity type */
export type FolderEntity = typeof Folder.$inferSelect
/** Insertable Folder input type */
export type CreateFolderInput = typeof Folder.$inferInsert
/** Updatable Folder input type */
export type UpdateFolderInput = Partial<CreateFolderInput>

/**
 * FolderModel encapsulates CRUD for the Folder table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class FolderModel extends BaseModel<
  typeof Folder,
  CreateFolderInput,
  FolderEntity,
  UpdateFolderInput
> {
  /** Drizzle table */
  get table() {
    return Folder
  }
}
