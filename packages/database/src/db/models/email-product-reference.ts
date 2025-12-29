// packages/database/src/db/models/email-product-reference.ts
// EmailProductReference model built on BaseModel (no org scope column)

import { EmailProductReference } from '../schema/email-product-reference'
import { BaseModel } from '../utils/base-model'

/** Selected EmailProductReference entity type */
export type EmailProductReferenceEntity = typeof EmailProductReference.$inferSelect
/** Insertable EmailProductReference input type */
export type CreateEmailProductReferenceInput = typeof EmailProductReference.$inferInsert
/** Updatable EmailProductReference input type */
export type UpdateEmailProductReferenceInput = Partial<CreateEmailProductReferenceInput>

/**
 * EmailProductReferenceModel encapsulates CRUD for the EmailProductReference table.
 * No org scoping is applied by default.
 */
export class EmailProductReferenceModel extends BaseModel<
  typeof EmailProductReference,
  CreateEmailProductReferenceInput,
  EmailProductReferenceEntity,
  UpdateEmailProductReferenceInput
> {
  /** Drizzle table */
  get table() {
    return EmailProductReference
  }
}
