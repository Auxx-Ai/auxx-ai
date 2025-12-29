// packages/database/src/db/models/inbox-member-access.ts
// InboxMemberAccess model built on BaseModel (no org scope column)

import { InboxMemberAccess } from '../schema/inbox-member-access'
import { BaseModel } from '../utils/base-model'

/** Selected InboxMemberAccess entity type */
export type InboxMemberAccessEntity = typeof InboxMemberAccess.$inferSelect
/** Insertable InboxMemberAccess input type */
export type CreateInboxMemberAccessInput = typeof InboxMemberAccess.$inferInsert
/** Updatable InboxMemberAccess input type */
export type UpdateInboxMemberAccessInput = Partial<CreateInboxMemberAccessInput>

/**
 * InboxMemberAccessModel encapsulates CRUD for the InboxMemberAccess table.
 * No org scoping is applied by default.
 */
export class InboxMemberAccessModel extends BaseModel<
  typeof InboxMemberAccess,
  CreateInboxMemberAccessInput,
  InboxMemberAccessEntity,
  UpdateInboxMemberAccessInput
> {
  /** Drizzle table */
  get table() {
    return InboxMemberAccess
  }
}
