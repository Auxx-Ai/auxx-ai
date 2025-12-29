// packages/database/src/db/models/chat-widget.ts
// ChatWidget model built on BaseModel (org-scoped)

import { ChatWidget } from '../schema/chat-widget'
import { BaseModel } from '../utils/base-model'

/** Selected ChatWidget entity type */
export type ChatWidgetEntity = typeof ChatWidget.$inferSelect
/** Insertable ChatWidget input type */
export type CreateChatWidgetInput = typeof ChatWidget.$inferInsert
/** Updatable ChatWidget input type */
export type UpdateChatWidgetInput = Partial<CreateChatWidgetInput>

/**
 * ChatWidgetModel encapsulates CRUD for the ChatWidget table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ChatWidgetModel extends BaseModel<
  typeof ChatWidget,
  CreateChatWidgetInput,
  ChatWidgetEntity,
  UpdateChatWidgetInput
> {
  /** Drizzle table */
  get table() {
    return ChatWidget
  }
}
