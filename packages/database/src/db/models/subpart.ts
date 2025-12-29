// packages/database/src/db/models/subpart.ts
// Subpart model built on BaseModel (org-scoped)

import { Subpart } from '../schema/subpart'
import { BaseModel } from '../utils/base-model'

/** Selected Subpart entity type */
export type SubpartEntity = typeof Subpart.$inferSelect
/** Insertable Subpart input type */
export type CreateSubpartInput = typeof Subpart.$inferInsert
/** Updatable Subpart input type */
export type UpdateSubpartInput = Partial<CreateSubpartInput>

/**
 * SubpartModel encapsulates CRUD for the Subpart table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class SubpartModel extends BaseModel<
  typeof Subpart,
  CreateSubpartInput,
  SubpartEntity,
  UpdateSubpartInput
> {
  /** Drizzle table */
  get table() {
    return Subpart
  }
}
