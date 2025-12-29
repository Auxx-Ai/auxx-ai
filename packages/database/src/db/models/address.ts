// packages/database/src/db/models/address.ts
// Address model built on BaseModel (org-scoped)

import { Address } from '../schema/address'
import { BaseModel } from '../utils/base-model'

/** Selected Address entity type */
export type AddressEntity = typeof Address.$inferSelect
/** Insertable Address input type */
export type CreateAddressInput = typeof Address.$inferInsert
/** Updatable Address input type */
export type UpdateAddressInput = Partial<CreateAddressInput>

/**
 * AddressModel encapsulates CRUD for the Address table.
 * Org-scoped via organizationId when provided to the constructor.
 * Note: This table has no `id` column or uses a composite key. BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class AddressModel extends BaseModel<
  typeof Address,
  CreateAddressInput,
  AddressEntity,
  UpdateAddressInput
> {
  /** Drizzle table */
  get table() {
    return Address
  }
}
