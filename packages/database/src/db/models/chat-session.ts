// packages/database/src/db/models/chat-session.ts
// ChatSession model built on BaseModel (org-scoped)

import { eq } from 'drizzle-orm'
import { ChatSession } from '../schema/chat-session'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected ChatSession entity type */
export type ChatSessionEntity = typeof ChatSession.$inferSelect
/** Insertable ChatSession input type */
export type CreateChatSessionInput = typeof ChatSession.$inferInsert
/** Updatable ChatSession input type */
export type UpdateChatSessionInput = Partial<CreateChatSessionInput>

/**
 * ChatSessionModel encapsulates CRUD for the ChatSession table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ChatSessionModel extends BaseModel<
  typeof ChatSession,
  CreateChatSessionInput,
  ChatSessionEntity,
  UpdateChatSessionInput
> {
  /** Drizzle table */
  get table() {
    return ChatSession
  }

  /** Global lookup by id without org scoping (for public verification) */
  async findByIdGlobal(id: string): Promise<TypedResult<ChatSessionEntity | null, Error>> {
    try {
      const rows = await this.db.select().from(ChatSession).where(eq(ChatSession.id, id)).limit(1)
      return Result.ok((rows?.[0] as ChatSessionEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
