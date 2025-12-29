// packages/database/src/db/models/inbox.ts
// Inbox model built on BaseModel (org-scoped)

import { Inbox } from '../schema/inbox'
import { BaseModel } from '../utils/base-model'

/** Selected Inbox entity type */
export type InboxEntity = typeof Inbox.$inferSelect
/** Insertable Inbox input type */
export type CreateInboxInput = typeof Inbox.$inferInsert
/** Updatable Inbox input type */
export type UpdateInboxInput = Partial<CreateInboxInput>

/**
 * InboxModel encapsulates CRUD for the Inbox table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class InboxModel extends BaseModel<
  typeof Inbox,
  CreateInboxInput,
  InboxEntity,
  UpdateInboxInput
> {
  get table() {
    return Inbox
  }
}
