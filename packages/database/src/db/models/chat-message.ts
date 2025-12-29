// packages/database/src/db/models/chat-message.ts
// ChatMessage model built on BaseModel (no org scope column)

import { ChatMessage } from '../schema/chat-message'
import { BaseModel } from '../utils/base-model'

/** Selected ChatMessage entity type */
export type ChatMessageEntity = typeof ChatMessage.$inferSelect
/** Insertable ChatMessage input type */
export type CreateChatMessageInput = typeof ChatMessage.$inferInsert
/** Updatable ChatMessage input type */
export type UpdateChatMessageInput = Partial<CreateChatMessageInput>

/**
 * ChatMessageModel encapsulates CRUD for the ChatMessage table.
 * No org scoping is applied by default.
 */
export class ChatMessageModel extends BaseModel<
  typeof ChatMessage,
  CreateChatMessageInput,
  ChatMessageEntity,
  UpdateChatMessageInput
> {
  /** Drizzle table */
  get table() {
    return ChatMessage
  }
}
