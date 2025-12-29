// packages/database/src/db/models/file-version.ts
// FileVersion model built on BaseModel (no org scope column)

import { FileVersion } from '../schema/file-version'
import { BaseModel } from '../utils/base-model'

/** Selected FileVersion entity type */
export type FileVersionEntity = typeof FileVersion.$inferSelect
/** Insertable FileVersion input type */
export type CreateFileVersionInput = typeof FileVersion.$inferInsert
/** Updatable FileVersion input type */
export type UpdateFileVersionInput = Partial<CreateFileVersionInput>

/**
 * FileVersionModel encapsulates CRUD for the FileVersion table.
 * No org scoping is applied by default.
 */
export class FileVersionModel extends BaseModel<
  typeof FileVersion,
  CreateFileVersionInput,
  FileVersionEntity,
  UpdateFileVersionInput
> {
  /** Drizzle table */
  get table() {
    return FileVersion
  }
}
