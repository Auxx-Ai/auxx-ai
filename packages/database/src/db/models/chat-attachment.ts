// packages/database/src/db/models/chat-attachment.ts
// ChatAttachment model built on BaseModel (no org scope column)

import { ChatAttachment } from '../schema/chat-attachment'
import { BaseModel } from '../utils/base-model'

/** Selected ChatAttachment entity type */
export type ChatAttachmentEntity = typeof ChatAttachment.$inferSelect
/** Insertable ChatAttachment input type */
export type CreateChatAttachmentInput = typeof ChatAttachment.$inferInsert
/** Updatable ChatAttachment input type */
export type UpdateChatAttachmentInput = Partial<CreateChatAttachmentInput>

/**
 * ChatAttachmentModel encapsulates CRUD for the ChatAttachment table.
 * No org scoping is applied by default.
 */
export class ChatAttachmentModel extends BaseModel<
  typeof ChatAttachment,
  CreateChatAttachmentInput,
  ChatAttachmentEntity,
  UpdateChatAttachmentInput
> {
  /** Drizzle table */
  get table() {
    return ChatAttachment
  }
}
