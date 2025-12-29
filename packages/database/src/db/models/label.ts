// packages/database/src/db/models/label.ts
// Label model (org-scoped) built on BaseModel

import { Label } from '../schema/label'
import { BaseModel } from '../utils/base-model'

/** Selected Label entity type */
export type LabelEntity = typeof Label.$inferSelect
/** Insertable Label input type */
export type CreateLabelInput = typeof Label.$inferInsert
/** Updatable Label input type */
export type UpdateLabelInput = Partial<CreateLabelInput>

/**
 * LabelModel encapsulates CRUD for the Label table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class LabelModel extends BaseModel<
  typeof Label,
  CreateLabelInput,
  LabelEntity,
  UpdateLabelInput
> {
  get table() {
    return Label
  }
}
