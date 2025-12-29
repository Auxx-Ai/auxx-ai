// packages/database/src/db/models/custom-field.ts
// CustomField model built on BaseModel (org-scoped)

import { CustomField } from '../schema/custom-field'
import { BaseModel } from '../utils/base-model'

/** Selected CustomField entity type */
export type CustomFieldEntity = typeof CustomField.$inferSelect
/** Insertable CustomField input type */
export type CreateCustomFieldInput = typeof CustomField.$inferInsert
/** Updatable CustomField input type */
export type UpdateCustomFieldInput = Partial<CreateCustomFieldInput>

/**
 * CustomFieldModel encapsulates CRUD for the CustomField table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class CustomFieldModel extends BaseModel<
  typeof CustomField,
  CreateCustomFieldInput,
  CustomFieldEntity,
  UpdateCustomFieldInput
> {
  /** Drizzle table */
  get table() {
    return CustomField
  }
}
