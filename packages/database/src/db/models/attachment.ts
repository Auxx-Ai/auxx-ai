// packages/database/src/db/models/attachment.ts
// Attachment model built on BaseModel (org-scoped)

import { Attachment } from '../schema/attachment'
import { BaseModel } from '../utils/base-model'

/** Selected Attachment entity type */
export type AttachmentEntity = typeof Attachment.$inferSelect
/** Insertable Attachment input type */
export type CreateAttachmentInput = typeof Attachment.$inferInsert
/** Updatable Attachment input type */
export type UpdateAttachmentInput = Partial<CreateAttachmentInput>

/**
 * AttachmentModel encapsulates CRUD for the Attachment table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class AttachmentModel extends BaseModel<
  typeof Attachment,
  CreateAttachmentInput,
  AttachmentEntity,
  UpdateAttachmentInput
> {
  /** Drizzle table */
  get table() {
    return Attachment
  }
}
