// packages/database/src/db/models/group.ts
// Group model built on BaseModel (org-scoped)

import { Group } from '../schema/group'
import { BaseModel } from '../utils/base-model'

/** Selected Group entity type */
export type GroupEntity = typeof Group.$inferSelect
/** Insertable Group input type */
export type CreateGroupInput = typeof Group.$inferInsert
/** Updatable Group input type */
export type UpdateGroupInput = Partial<CreateGroupInput>

/**
 * GroupModel encapsulates CRUD for the Group table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class GroupModel extends BaseModel<
  typeof Group,
  CreateGroupInput,
  GroupEntity,
  UpdateGroupInput
> {
  /** Drizzle table */
  get table() {
    return Group
  }
}
