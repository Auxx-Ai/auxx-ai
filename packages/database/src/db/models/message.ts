// packages/database/src/db/models/message.ts
// Message model (org-scoped) built on BaseModel

import { Message } from '../schema/message'
import { BaseModel } from '../utils/base-model'

/** Selected Message entity type */
export type MessageEntity = typeof Message.$inferSelect
/** Insertable Message input type */
export type CreateMessageInput = typeof Message.$inferInsert
/** Updatable Message input type */
export type UpdateMessageInput = Partial<CreateMessageInput>

/**
 * MessageModel encapsulates CRUD for the Message table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class MessageModel extends BaseModel<
  typeof Message,
  CreateMessageInput,
  MessageEntity,
  UpdateMessageInput
> {
  get table() {
    return Message
  }
}
