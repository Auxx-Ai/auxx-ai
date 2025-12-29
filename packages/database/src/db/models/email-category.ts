// packages/database/src/db/models/email-category.ts
// EmailCategory model built on BaseModel (org-scoped)

import { EmailCategory } from '../schema/email-category'
import { BaseModel } from '../utils/base-model'

/** Selected EmailCategory entity type */
export type EmailCategoryEntity = typeof EmailCategory.$inferSelect
/** Insertable EmailCategory input type */
export type CreateEmailCategoryInput = typeof EmailCategory.$inferInsert
/** Updatable EmailCategory input type */
export type UpdateEmailCategoryInput = Partial<CreateEmailCategoryInput>

/**
 * EmailCategoryModel encapsulates CRUD for the EmailCategory table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class EmailCategoryModel extends BaseModel<
  typeof EmailCategory,
  CreateEmailCategoryInput,
  EmailCategoryEntity,
  UpdateEmailCategoryInput
> {
  /** Drizzle table */
  get table() {
    return EmailCategory
  }
}
