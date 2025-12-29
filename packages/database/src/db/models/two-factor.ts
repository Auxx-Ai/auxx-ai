// packages/database/src/db/models/two-factor.ts
// TwoFactor model built on BaseModel (no org scope column)

import { TwoFactor } from '../schema/two-factor'
import { BaseModel } from '../utils/base-model'

/** Selected TwoFactor entity type */
export type TwoFactorEntity = typeof TwoFactor.$inferSelect
/** Insertable TwoFactor input type */
export type CreateTwoFactorInput = typeof TwoFactor.$inferInsert
/** Updatable TwoFactor input type */
export type UpdateTwoFactorInput = Partial<CreateTwoFactorInput>

/**
 * TwoFactorModel encapsulates CRUD for the TwoFactor table.
 * No org scoping is applied by default.
 */
export class TwoFactorModel extends BaseModel<
  typeof TwoFactor,
  CreateTwoFactorInput,
  TwoFactorEntity,
  UpdateTwoFactorInput
> {
  /** Drizzle table */
  get table() {
    return TwoFactor
  }
}
