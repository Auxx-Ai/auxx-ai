// packages/database/src/db/models/contact.ts
// Contact model built on BaseModel (org-scoped)

import { Contact } from '../schema/contact'
import { BaseModel } from '../utils/base-model'

/** Selected Contact entity type */
export type ContactEntity = typeof Contact.$inferSelect
/** Insertable Contact input type */
export type CreateContactInput = typeof Contact.$inferInsert
/** Updatable Contact input type */
export type UpdateContactInput = Partial<CreateContactInput>

/**
 * ContactModel encapsulates CRUD for the Contact table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ContactModel extends BaseModel<
  typeof Contact,
  CreateContactInput,
  ContactEntity,
  UpdateContactInput
> {
  /** Drizzle table */
  get table() {
    return Contact
  }
}
