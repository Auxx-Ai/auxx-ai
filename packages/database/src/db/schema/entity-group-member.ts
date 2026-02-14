// packages/database/src/db/schema/entity-group-member.ts
// Drizzle table: entityGroupMember

import { createId } from '@paralleldrive/cuid2'
import type { MemberType } from '../../enums'
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { EntityInstance } from './entity-instance'
import { User } from './user'

/**
 * EntityGroupMember table for storing group memberships
 *
 * Supports both entity instances and users as members via the memberType discriminator.
 * - memberType: 'entity' -> memberRefId is an EntityInstance.id
 * - memberType: 'user' -> memberRefId is a User.id
 */
export const EntityGroupMember = pgTable(
  'EntityGroupMember',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** The group (an EntityInstance with resourceType: 'entity_group') */
    groupInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Member type discriminator - determines how to interpret memberRefId */
    memberType: text().notNull().$type<MemberType>(),

    /**
     * Reference ID - interpreted based on memberType
     * - MemberType.entity -> EntityInstance.id
     * - MemberType.user -> User.id
     */
    memberRefId: text().notNull(),

    /** User who added this member (for audit) */
    addedById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Ordering within group (fractional indexing) */
    sortKey: text().notNull().default('a0'),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Unique membership per group (type + ref)
    uniqueIndex('EntityGroupMember_group_member_key').using(
      'btree',
      table.groupInstanceId.asc().nullsLast(),
      table.memberType.asc().nullsLast(),
      table.memberRefId.asc().nullsLast()
    ),

    // Efficient lookups by group
    index('EntityGroupMember_group_idx').using('btree', table.groupInstanceId.asc().nullsLast()),

    // Efficient lookups by member (for "get groups for entity/user")
    index('EntityGroupMember_member_idx').using(
      'btree',
      table.memberType.asc().nullsLast(),
      table.memberRefId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from EntityGroupMember table */
export type EntityGroupMemberEntity = typeof EntityGroupMember.$inferSelect

/** Type for inserting into EntityGroupMember table */
export type EntityGroupMemberInsert = typeof EntityGroupMember.$inferInsert
