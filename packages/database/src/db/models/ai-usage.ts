// packages/database/src/db/models/ai-usage.ts
// AiUsage model built on BaseModel (org-scoped)

import { AiUsage } from '../schema/ai-usage'
import { BaseModel } from '../utils/base-model'

/** Selected AiUsage entity type */
export type AiUsageEntity = typeof AiUsage.$inferSelect
/** Insertable AiUsage input type */
export type CreateAiUsageInput = typeof AiUsage.$inferInsert
/** Updatable AiUsage input type */
export type UpdateAiUsageInput = Partial<CreateAiUsageInput>

/**
 * AiUsageModel encapsulates CRUD for the AiUsage table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class AiUsageModel extends BaseModel<
  typeof AiUsage,
  CreateAiUsageInput,
  AiUsageEntity,
  UpdateAiUsageInput
> {
  /** Drizzle table */
  get table() {
    return AiUsage
  }
}
