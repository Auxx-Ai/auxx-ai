// packages/database/src/db/models/storage-location.ts
// StorageLocation model built on BaseModel (no org scope column)

import { StorageLocation } from '../schema/storage-location'
import { BaseModel } from '../utils/base-model'

/** Selected StorageLocation entity type */
export type StorageLocationEntity = typeof StorageLocation.$inferSelect
/** Insertable StorageLocation input type */
export type CreateStorageLocationInput = typeof StorageLocation.$inferInsert
/** Updatable StorageLocation input type */
export type UpdateStorageLocationInput = Partial<CreateStorageLocationInput>

/**
 * StorageLocationModel encapsulates CRUD for the StorageLocation table.
 * No org scoping is applied by default.
 */
export class StorageLocationModel extends BaseModel<
  typeof StorageLocation,
  CreateStorageLocationInput,
  StorageLocationEntity,
  UpdateStorageLocationInput
> {
  /** Drizzle table */
  get table() {
    return StorageLocation
  }
}
