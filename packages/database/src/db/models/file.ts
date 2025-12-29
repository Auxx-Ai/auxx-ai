// packages/database/src/db/models/file.ts
// File model built on BaseModel (org-scoped)

import { File } from '../schema/file'
import { BaseModel } from '../utils/base-model'

/** Selected File entity type */
export type FileEntity = typeof File.$inferSelect
/** Insertable File input type */
export type CreateFileInput = typeof File.$inferInsert
/** Updatable File input type */
export type UpdateFileInput = Partial<CreateFileInput>

/**
 * FileModel encapsulates CRUD for the File table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class FileModel extends BaseModel<
  typeof File,
  CreateFileInput,
  FileEntity,
  UpdateFileInput
> {
  /** Drizzle table */
  get table() {
    return File
  }
}
