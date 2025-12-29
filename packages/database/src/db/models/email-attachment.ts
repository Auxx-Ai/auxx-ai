// packages/database/src/db/models/email-attachment.ts
// EmailAttachment model built on BaseModel (no org scope column)

import { EmailAttachment } from '../schema/email-attachment'
import { BaseModel } from '../utils/base-model'

/** Selected EmailAttachment entity type */
export type EmailAttachmentEntity = typeof EmailAttachment.$inferSelect
/** Insertable EmailAttachment input type */
export type CreateEmailAttachmentInput = typeof EmailAttachment.$inferInsert
/** Updatable EmailAttachment input type */
export type UpdateEmailAttachmentInput = Partial<CreateEmailAttachmentInput>

/**
 * EmailAttachmentModel encapsulates CRUD for the EmailAttachment table.
 * No org scoping is applied by default.
 */
export class EmailAttachmentModel extends BaseModel<
  typeof EmailAttachment,
  CreateEmailAttachmentInput,
  EmailAttachmentEntity,
  UpdateEmailAttachmentInput
> {
  /** Drizzle table */
  get table() {
    return EmailAttachment
  }
}
