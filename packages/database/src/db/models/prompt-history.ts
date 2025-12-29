// packages/database/src/db/models/prompt-history.ts
// PromptHistory model built on BaseModel (no org scope column)

import { PromptHistory } from '../schema/prompt-history'
import { BaseModel } from '../utils/base-model'

/** Selected PromptHistory entity type */
export type PromptHistoryEntity = typeof PromptHistory.$inferSelect
/** Insertable PromptHistory input type */
export type CreatePromptHistoryInput = typeof PromptHistory.$inferInsert
/** Updatable PromptHistory input type */
export type UpdatePromptHistoryInput = Partial<CreatePromptHistoryInput>

/**
 * PromptHistoryModel encapsulates CRUD for the PromptHistory table.
 * No org scoping is applied by default.
 */
export class PromptHistoryModel extends BaseModel<
  typeof PromptHistory,
  CreatePromptHistoryInput,
  PromptHistoryEntity,
  UpdatePromptHistoryInput
> {
  /** Drizzle table */
  get table() {
    return PromptHistory
  }
}
