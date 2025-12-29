// packages/database/src/db/models/account.ts
// account model built on BaseModel (no org scope column)

import { account } from '../schema/account'
import { BaseModel } from '../utils/base-model'

/** Selected account entity type */
export type accountEntity = typeof account.$inferSelect
/** Insertable account input type */
export type CreateaccountInput = typeof account.$inferInsert
/** Updatable account input type */
export type UpdateaccountInput = Partial<CreateaccountInput>

/**
 * accountModel encapsulates CRUD for the account table.
 * No org scoping is applied by default.
 */
export class accountModel extends BaseModel<
  typeof account,
  CreateaccountInput,
  accountEntity,
  UpdateaccountInput
> {
  /** Drizzle table */
  get table() {
    return account
  }
}
