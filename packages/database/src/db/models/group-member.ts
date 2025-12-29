// packages/database/src/db/models/group-member.ts
// GroupMember model built on BaseModel (no org scope column)

import { GroupMember } from '../schema/group-member'
import { BaseModel } from '../utils/base-model'

/** Selected GroupMember entity type */
export type GroupMemberEntity = typeof GroupMember.$inferSelect
/** Insertable GroupMember input type */
export type CreateGroupMemberInput = typeof GroupMember.$inferInsert
/** Updatable GroupMember input type */
export type UpdateGroupMemberInput = Partial<CreateGroupMemberInput>

/**
 * GroupMemberModel encapsulates CRUD for the GroupMember table.
 * No org scoping is applied by default.
 */
export class GroupMemberModel extends BaseModel<
  typeof GroupMember,
  CreateGroupMemberInput,
  GroupMemberEntity,
  UpdateGroupMemberInput
> {
  /** Drizzle table */
  get table() {
    return GroupMember
  }
}
