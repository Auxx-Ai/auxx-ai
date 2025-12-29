// packages/database/src/db/models/verification.ts
// verification model built on BaseModel (no org scope column)

import { verification } from '../schema/verification'
import { BaseModel } from '../utils/base-model'

/** Selected verification entity type */
export type verificationEntity = typeof verification.$inferSelect
/** Insertable verification input type */
export type CreateverificationInput = typeof verification.$inferInsert
/** Updatable verification input type */
export type UpdateverificationInput = Partial<CreateverificationInput>

/**
 * verificationModel encapsulates CRUD for the verification table.
 * No org scoping is applied by default.
 */
export class verificationModel extends BaseModel<
  typeof verification,
  CreateverificationInput,
  verificationEntity,
  UpdateverificationInput
> {
  /** Drizzle table */
  get table() {
    return verification
  }
}
