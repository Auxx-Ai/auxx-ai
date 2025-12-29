// packages/database/src/db/models/folder-file.ts
// FolderFile model built on BaseModel (org-scoped)

import { FolderFile } from '../schema/folder-file'
import { BaseModel } from '../utils/base-model'

/** Selected FolderFile entity type */
export type FolderFileEntity = typeof FolderFile.$inferSelect
/** Insertable FolderFile input type */
export type CreateFolderFileInput = typeof FolderFile.$inferInsert
/** Updatable FolderFile input type */
export type UpdateFolderFileInput = Partial<CreateFolderFileInput>

/**
 * FolderFileModel encapsulates CRUD for the FolderFile table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class FolderFileModel extends BaseModel<
  typeof FolderFile,
  CreateFolderFileInput,
  FolderFileEntity,
  UpdateFolderFileInput
> {
  /** Drizzle table */
  get table() {
    return FolderFile
  }
}
