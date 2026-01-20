// packages/database/src/db/relations/entity-group.ts
// Relations for entity group tables

import { relations } from 'drizzle-orm'
import { EntityGroupMember, EntityGroupPermission, EntityInstance, User } from '../schema'

/**
 * EntityGroupMember relations
 *
 * Note: memberRefId is polymorphic (can reference EntityInstance or User based on memberType).
 * We define the groupInstance and addedBy relations, but resolving the member
 * must be done in application code based on memberType.
 */
export const entityGroupMemberRelations = relations(EntityGroupMember, ({ one }) => ({
  /** The group this membership belongs to (an EntityInstance with resourceType: 'entity_group') */
  groupInstance: one(EntityInstance, {
    fields: [EntityGroupMember.groupInstanceId],
    references: [EntityInstance.id],
  }),
  /** User who added this member */
  addedBy: one(User, {
    fields: [EntityGroupMember.addedById],
    references: [User.id],
  }),
}))

/**
 * EntityGroupPermission relations
 *
 * Note: granteeId is polymorphic (can reference User, Group/team, or role string based on granteeType).
 * We define the groupInstance and grantedBy relations, but resolving the grantee
 * must be done in application code based on granteeType.
 */
export const entityGroupPermissionRelations = relations(EntityGroupPermission, ({ one }) => ({
  /** The group this permission applies to */
  groupInstance: one(EntityInstance, {
    fields: [EntityGroupPermission.groupInstanceId],
    references: [EntityInstance.id],
  }),
  /** User who granted this permission */
  grantedBy: one(User, {
    fields: [EntityGroupPermission.grantedById],
    references: [User.id],
  }),
}))
