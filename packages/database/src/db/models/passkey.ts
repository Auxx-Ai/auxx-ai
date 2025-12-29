// packages/database/src/db/models/passkey.ts
// Passkey model built on BaseModel (no org scope column)

import { Passkey } from '../schema/passkey'
import { BaseModel } from '../utils/base-model'

/** Selected Passkey entity type */
export type PasskeyEntity = typeof Passkey.$inferSelect
/** Insertable Passkey input type */
export type CreatePasskeyInput = typeof Passkey.$inferInsert
/** Updatable Passkey input type */
export type UpdatePasskeyInput = Partial<CreatePasskeyInput>

/**
 * PasskeyModel encapsulates CRUD for the Passkey table.
 * No org scoping is applied by default.
 */
export class PasskeyModel extends BaseModel<
  typeof Passkey,
  CreatePasskeyInput,
  PasskeyEntity,
  UpdatePasskeyInput
> {
  /** Drizzle table */
  get table() {
    return Passkey
  }
}
