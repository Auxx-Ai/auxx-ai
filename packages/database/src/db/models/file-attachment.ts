// packages/database/src/db/models/file-attachment.ts
// FileAttachment model built on BaseModel (no org scope column)

import { FileAttachment } from '../schema/file-attachment'
import { BaseModel } from '../utils/base-model'

/** Selected FileAttachment entity type */
export type FileAttachmentEntity = typeof FileAttachment.$inferSelect
/** Insertable FileAttachment input type */
export type CreateFileAttachmentInput = typeof FileAttachment.$inferInsert
/** Updatable FileAttachment input type */
export type UpdateFileAttachmentInput = Partial<CreateFileAttachmentInput>

/**
 * FileAttachmentModel encapsulates CRUD for the FileAttachment table.
 * No org scoping is applied by default.
 */
export class FileAttachmentModel extends BaseModel<
  typeof FileAttachment,
  CreateFileAttachmentInput,
  FileAttachmentEntity,
  UpdateFileAttachmentInput
> {
  /** Drizzle table */
  get table() {
    return FileAttachment
  }
}
