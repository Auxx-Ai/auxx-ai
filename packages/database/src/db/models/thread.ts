// packages/database/src/db/models/thread.ts
// Thread model (org-scoped) built on BaseModel

import { Thread } from '../schema/thread'
import { BaseModel } from '../utils/base-model'

/** Selected Thread entity type */
export type ThreadEntity = typeof Thread.$inferSelect
/** Insertable Thread input type */
export type CreateThreadInput = typeof Thread.$inferInsert
/** Updatable Thread input type */
export type UpdateThreadInput = Partial<CreateThreadInput>

/**
 * ThreadModel encapsulates CRUD for the Thread table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ThreadModel extends BaseModel<
  typeof Thread,
  CreateThreadInput,
  ThreadEntity,
  UpdateThreadInput
> {
  get table() {
    return Thread
  }
}
