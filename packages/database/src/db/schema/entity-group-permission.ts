// packages/database/src/db/schema/entity-group-permission.ts
// Drizzle table: entityGroupPermission

import { pgTable, uniqueIndex, index, text, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'

import { EntityInstance } from './entity-instance'
import { User } from './user'
import type { PermissionLevel, GranteeType } from '../../enums'

/**
 * EntityGroupPermission table for storing group access permissions
 *
 * Supports three grantee types:
 * - 'user': Direct user permission (granteeId = User.id)
 * - 'team': Team-based permission (granteeId = Group.id from the teams system)
 * - 'role': Role-based permission (granteeId = role identifier like 'org_member')
 */
export const EntityGroupPermission = pgTable(
  'EntityGroupPermission',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** The group this permission applies to */
    groupInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** Type of grantee - determines how to interpret granteeId */
    granteeType: text().notNull().$type<GranteeType>(),

    /**
     * The grantee identifier
     * - GranteeType.user -> User.id
     * - GranteeType.team -> Group.id (from teams system)
     * - GranteeType.role -> role string like 'org_member'
     */
    granteeId: text().notNull(),

    /** Permission level granted (view < edit < manage_members < admin) */
    permission: text().notNull().$type<PermissionLevel>(),

    /** User who granted this permission (for audit) */
    grantedById: text().references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'set null' }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Unique permission per grantee per group
    uniqueIndex('EntityGroupPermission_group_grantee_key').using(
      'btree',
      table.groupInstanceId.asc().nullsLast(),
      table.granteeType.asc().nullsLast(),
      table.granteeId.asc().nullsLast()
    ),

    // Efficient lookups by group
    index('EntityGroupPermission_group_idx').using('btree', table.groupInstanceId.asc().nullsLast()),

    // Efficient lookups by grantee (for permission checks)
    index('EntityGroupPermission_grantee_idx').using(
      'btree',
      table.granteeType.asc().nullsLast(),
      table.granteeId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from EntityGroupPermission table */
export type EntityGroupPermissionEntity = typeof EntityGroupPermission.$inferSelect

/** Type for inserting into EntityGroupPermission table */
export type EntityGroupPermissionInsert = typeof EntityGroupPermission.$inferInsert
