// packages/database/src/db/models/user-inbox-unread-count.ts
// UserInboxUnreadCount model (org-scoped) built on BaseModel

import { and, eq } from 'drizzle-orm'
import { UserInboxUnreadCount } from '../schema/user-inbox-unread-count'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected UserInboxUnreadCount entity type */
export type UserInboxUnreadCountEntity = typeof UserInboxUnreadCount.$inferSelect

/** Insertable UserInboxUnreadCount input type */
export type CreateUserInboxUnreadCountInput = typeof UserInboxUnreadCount.$inferInsert

/** Updatable UserInboxUnreadCount input type */
export type UpdateUserInboxUnreadCountInput = Partial<CreateUserInboxUnreadCountInput>

export class UserInboxUnreadCountModel extends BaseModel<
  typeof UserInboxUnreadCount,
  CreateUserInboxUnreadCountInput,
  UserInboxUnreadCountEntity,
  UpdateUserInboxUnreadCountInput
> {
  get table() {
    return UserInboxUnreadCount
  }

  async getFor(
    userId: string,
    inboxId: string
  ): Promise<TypedResult<UserInboxUnreadCountEntity | null, Error>> {
    try {
      const rows = await this.findMany({
        where: and(
          eq(UserInboxUnreadCount.userId, userId),
          eq(UserInboxUnreadCount.inboxId, inboxId)
        ),
        limit: 1,
      })
      if (!rows.ok) return rows
      return Result.ok(rows.value[0] ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
