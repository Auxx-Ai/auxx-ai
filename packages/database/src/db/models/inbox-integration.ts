// packages/database/src/db/models/inbox-integration.ts
// InboxIntegration model built on BaseModel (no org scope column)

import { eq } from 'drizzle-orm'
import { InboxIntegration } from '../schema/inbox-integration'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected InboxIntegration entity type */
export type InboxIntegrationEntity = typeof InboxIntegration.$inferSelect

/** Insertable InboxIntegration input type */
export type CreateInboxIntegrationInput = typeof InboxIntegration.$inferInsert

/** Updatable InboxIntegration input type */
export type UpdateInboxIntegrationInput = Partial<CreateInboxIntegrationInput>

export class InboxIntegrationModel extends BaseModel<
  typeof InboxIntegration,
  CreateInboxIntegrationInput,
  InboxIntegrationEntity,
  UpdateInboxIntegrationInput
> {
  get table() {
    return InboxIntegration
  }

  async findByInbox(inboxId: string): Promise<TypedResult<InboxIntegrationEntity[], Error>> {
    try {
      return this.findMany({ where: eq(InboxIntegration.inboxId, inboxId) })
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
