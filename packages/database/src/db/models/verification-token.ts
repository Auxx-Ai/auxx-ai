// packages/database/src/db/models/verification-token.ts
// VerificationToken model built on BaseModel (no org scope column)

import { VerificationToken } from '../schema/verification-token'
import { BaseModel } from '../utils/base-model'

/** Selected VerificationToken entity type */
export type VerificationTokenEntity = typeof VerificationToken.$inferSelect
/** Insertable VerificationToken input type */
export type CreateVerificationTokenInput = typeof VerificationToken.$inferInsert
/** Updatable VerificationToken input type */
export type UpdateVerificationTokenInput = Partial<CreateVerificationTokenInput>

/**
 * VerificationTokenModel encapsulates CRUD for the VerificationToken table.
 * No org scoping is applied by default.
 */
export class VerificationTokenModel extends BaseModel<
  typeof VerificationToken,
  CreateVerificationTokenInput,
  VerificationTokenEntity,
  UpdateVerificationTokenInput
> {
  /** Drizzle table */
  get table() {
    return VerificationToken
  }
}
