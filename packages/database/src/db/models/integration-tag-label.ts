// packages/database/src/db/models/integration-tag-label.ts
// IntegrationTagLabel model built on BaseModel (org-scoped)

import { IntegrationTagLabel } from '../schema/integration-tag-label'
import { BaseModel } from '../utils/base-model'

/** Selected IntegrationTagLabel entity type */
export type IntegrationTagLabelEntity = typeof IntegrationTagLabel.$inferSelect
/** Insertable IntegrationTagLabel input type */
export type CreateIntegrationTagLabelInput = typeof IntegrationTagLabel.$inferInsert
/** Updatable IntegrationTagLabel input type */
export type UpdateIntegrationTagLabelInput = Partial<CreateIntegrationTagLabelInput>

/**
 * IntegrationTagLabelModel encapsulates CRUD for the IntegrationTagLabel table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class IntegrationTagLabelModel extends BaseModel<
  typeof IntegrationTagLabel,
  CreateIntegrationTagLabelInput,
  IntegrationTagLabelEntity,
  UpdateIntegrationTagLabelInput
> {
  /** Drizzle table */
  get table() {
    return IntegrationTagLabel
  }
}
