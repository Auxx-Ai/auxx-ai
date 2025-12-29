// packages/database/src/db/models/custom-field-value.ts
// CustomFieldValue model built on BaseModel (no org scope column)

import { CustomFieldValue } from '../schema/custom-field-value'
import { BaseModel } from '../utils/base-model'

/** Selected CustomFieldValue entity type */
export type CustomFieldValueEntity = typeof CustomFieldValue.$inferSelect
/** Insertable CustomFieldValue input type */
export type CreateCustomFieldValueInput = typeof CustomFieldValue.$inferInsert
/** Updatable CustomFieldValue input type */
export type UpdateCustomFieldValueInput = Partial<CreateCustomFieldValueInput>

/**
 * CustomFieldValueModel encapsulates CRUD for the CustomFieldValue table.
 * No org scoping is applied by default.
 */
export class CustomFieldValueModel extends BaseModel<
  typeof CustomFieldValue,
  CreateCustomFieldValueInput,
  CustomFieldValueEntity,
  UpdateCustomFieldValueInput
> {
  /** Drizzle table */
  get table() {
    return CustomFieldValue
  }
}
