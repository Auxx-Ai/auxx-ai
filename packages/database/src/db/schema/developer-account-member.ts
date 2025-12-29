// packages/database/src/db/schema/developer-account-member.ts
// Drizzle table for developer account member

import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { User } from './user'
import { DeveloperAccount } from './developer-account'

/** Drizzle table for DeveloperAccountMember */
export const DeveloperAccountMember = pgTable(
  'DeveloperAccountMember',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    developerAccountId: text()
      .notNull()
      .references((): AnyPgColumn => DeveloperAccount.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    emailAddress: text().notNull(),

    // Access level: admin or member
    accessLevel: text().notNull().default('member'),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('DeveloperAccountMember_unique_idx').using(
      'btree',
      table.developerAccountId.asc().nullsLast(),
      table.userId.asc().nullsLast()
    ),
    index('DeveloperAccountMember_userId_idx').using('btree', table.userId.asc().nullsLast()),
  ]
)
