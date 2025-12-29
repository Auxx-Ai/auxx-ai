// packages/database/src/db/models/email-address.ts
// EmailAddress model built on BaseModel (no org scope column)

import { EmailAddress } from '../schema/email-address'
import { BaseModel } from '../utils/base-model'

/** Selected EmailAddress entity type */
export type EmailAddressEntity = typeof EmailAddress.$inferSelect
/** Insertable EmailAddress input type */
export type CreateEmailAddressInput = typeof EmailAddress.$inferInsert
/** Updatable EmailAddress input type */
export type UpdateEmailAddressInput = Partial<CreateEmailAddressInput>

/**
 * EmailAddressModel encapsulates CRUD for the EmailAddress table.
 * No org scoping is applied by default.
 */
export class EmailAddressModel extends BaseModel<
  typeof EmailAddress,
  CreateEmailAddressInput,
  EmailAddressEntity,
  UpdateEmailAddressInput
> {
  /** Drizzle table */
  get table() {
    return EmailAddress
  }
}
