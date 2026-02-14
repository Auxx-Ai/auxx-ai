// packages/database/src/db/schema/user-inbox-unread-count.ts
// Drizzle table: userInboxUnreadCount

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, pgTable, text, timestamp, uniqueIndex } from './_shared'

import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

/**
 * Drizzle table for userInboxUnreadCount
 * Tracks unread message counts per user per inbox EntityInstance
 */
export const UserInboxUnreadCount = pgTable(
  'UserInboxUnreadCount',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    /** References inbox EntityInstance.id */
    inboxId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    unreadCount: integer().default(0).notNull(),
    lastUpdatedAt: timestamp({ precision: 3 }).notNull(),
  },
  (table) => [
    index('UserInboxUnreadCount_inboxId_idx').using('btree', table.inboxId.asc().nullsLast()),
    index('UserInboxUnreadCount_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    uniqueIndex('UserInboxUnreadCount_organizationId_inboxId_userId_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.inboxId.asc().nullsLast(),
      table.userId.asc().nullsLast()
    ),
    index('UserInboxUnreadCount_organizationId_userId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.userId.asc().nullsLast()
    ),
    index('UserInboxUnreadCount_userId_idx').using('btree', table.userId.asc().nullsLast()),
  ]
)
