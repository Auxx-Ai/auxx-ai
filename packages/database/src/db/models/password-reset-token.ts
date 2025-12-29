// packages/database/src/db/models/password-reset-token.ts
// PasswordResetToken model built on BaseModel (no org scope column)

import { PasswordResetToken } from '../schema/password-reset-token'
import { BaseModel } from '../utils/base-model'

/** Selected PasswordResetToken entity type */
export type PasswordResetTokenEntity = typeof PasswordResetToken.$inferSelect
/** Insertable PasswordResetToken input type */
export type CreatePasswordResetTokenInput = typeof PasswordResetToken.$inferInsert
/** Updatable PasswordResetToken input type */
export type UpdatePasswordResetTokenInput = Partial<CreatePasswordResetTokenInput>

/**
 * PasswordResetTokenModel encapsulates CRUD for the PasswordResetToken table.
 * No org scoping is applied by default.
 */
export class PasswordResetTokenModel extends BaseModel<
  typeof PasswordResetToken,
  CreatePasswordResetTokenInput,
  PasswordResetTokenEntity,
  UpdatePasswordResetTokenInput
> {
  /** Drizzle table */
  get table() {
    return PasswordResetToken
  }
}
