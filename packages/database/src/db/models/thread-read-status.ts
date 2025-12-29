// packages/database/src/db/models/thread-read-status.ts
// ThreadReadStatus model (org-scoped) built on BaseModel

import { and, eq } from 'drizzle-orm'
import { ThreadReadStatus } from '../schema/thread-read-status'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected ThreadReadStatus entity type */
export type ThreadReadStatusEntity = typeof ThreadReadStatus.$inferSelect

/** Insertable ThreadReadStatus input type */
export type CreateThreadReadStatusInput = typeof ThreadReadStatus.$inferInsert

/** Updatable ThreadReadStatus input type */
export type UpdateThreadReadStatusInput = Partial<CreateThreadReadStatusInput>

export class ThreadReadStatusModel extends BaseModel<
  typeof ThreadReadStatus,
  CreateThreadReadStatusInput,
  ThreadReadStatusEntity,
  UpdateThreadReadStatusInput
> {
  get table() {
    return ThreadReadStatus
  }

  async getFor(userId: string, threadId: string): Promise<TypedResult<ThreadReadStatusEntity | null, Error>> {
    try {
      const res = await this.findMany({ where: and(eq(ThreadReadStatus.userId, userId), eq(ThreadReadStatus.threadId, threadId)), limit: 1 })
      if (!res.ok) return res
      return Result.ok(res.value[0] ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}

