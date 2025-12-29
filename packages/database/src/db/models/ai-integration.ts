// packages/database/src/db/models/ai-integration.ts
// AiIntegration model built on BaseModel (org-scoped)

import { AiIntegration } from '../schema/ai-integration'
import { BaseModel } from '../utils/base-model'

/** Selected AiIntegration entity type */
export type AiIntegrationEntity = typeof AiIntegration.$inferSelect
/** Insertable AiIntegration input type */
export type CreateAiIntegrationInput = typeof AiIntegration.$inferInsert
/** Updatable AiIntegration input type */
export type UpdateAiIntegrationInput = Partial<CreateAiIntegrationInput>

/**
 * AiIntegrationModel encapsulates CRUD for the AiIntegration table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class AiIntegrationModel extends BaseModel<
  typeof AiIntegration,
  CreateAiIntegrationInput,
  AiIntegrationEntity,
  UpdateAiIntegrationInput
> {
  /** Drizzle table */
  get table() {
    return AiIntegration
  }
}
