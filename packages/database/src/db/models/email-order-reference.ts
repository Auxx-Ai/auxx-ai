// packages/database/src/db/models/email-order-reference.ts
// EmailOrderReference model built on BaseModel (no org scope column)

import { EmailOrderReference } from '../schema/email-order-reference'
import { BaseModel } from '../utils/base-model'

/** Selected EmailOrderReference entity type */
export type EmailOrderReferenceEntity = typeof EmailOrderReference.$inferSelect
/** Insertable EmailOrderReference input type */
export type CreateEmailOrderReferenceInput = typeof EmailOrderReference.$inferInsert
/** Updatable EmailOrderReference input type */
export type UpdateEmailOrderReferenceInput = Partial<CreateEmailOrderReferenceInput>

/**
 * EmailOrderReferenceModel encapsulates CRUD for the EmailOrderReference table.
 * No org scoping is applied by default.
 */
export class EmailOrderReferenceModel extends BaseModel<
  typeof EmailOrderReference,
  CreateEmailOrderReferenceInput,
  EmailOrderReferenceEntity,
  UpdateEmailOrderReferenceInput
> {
  /** Drizzle table */
  get table() {
    return EmailOrderReference
  }
}
