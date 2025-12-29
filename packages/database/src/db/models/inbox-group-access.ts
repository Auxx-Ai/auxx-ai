// packages/database/src/db/models/inbox-group-access.ts
// InboxGroupAccess model built on BaseModel (no org scope column)

import { InboxGroupAccess } from '../schema/inbox-group-access'
import { BaseModel } from '../utils/base-model'

/** Selected InboxGroupAccess entity type */
export type InboxGroupAccessEntity = typeof InboxGroupAccess.$inferSelect
/** Insertable InboxGroupAccess input type */
export type CreateInboxGroupAccessInput = typeof InboxGroupAccess.$inferInsert
/** Updatable InboxGroupAccess input type */
export type UpdateInboxGroupAccessInput = Partial<CreateInboxGroupAccessInput>

/**
 * InboxGroupAccessModel encapsulates CRUD for the InboxGroupAccess table.
 * No org scoping is applied by default.
 */
export class InboxGroupAccessModel extends BaseModel<
  typeof InboxGroupAccess,
  CreateInboxGroupAccessInput,
  InboxGroupAccessEntity,
  UpdateInboxGroupAccessInput
> {
  /** Drizzle table */
  get table() {
    return InboxGroupAccess
  }
}
