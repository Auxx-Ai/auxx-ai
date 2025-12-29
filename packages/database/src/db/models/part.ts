// packages/database/src/db/models/part.ts
// Part model built on BaseModel (org-scoped)

import { Part } from '../schema/part'
import { BaseModel } from '../utils/base-model'

/** Selected Part entity type */
export type PartEntity = typeof Part.$inferSelect
/** Insertable Part input type */
export type CreatePartInput = typeof Part.$inferInsert
/** Updatable Part input type */
export type UpdatePartInput = Partial<CreatePartInput>

/**
 * PartModel encapsulates CRUD for the Part table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class PartModel extends BaseModel<
  typeof Part,
  CreatePartInput,
  PartEntity,
  UpdatePartInput
> {
  /** Drizzle table */
  get table() {
    return Part
  }
}
