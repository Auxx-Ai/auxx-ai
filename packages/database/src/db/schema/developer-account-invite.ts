// packages/database/src/db/schema/developer-account-invite.ts
// Drizzle table for developer account invite

import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  type AnyPgColumn,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { DeveloperAccount } from './developer-account'

/** Drizzle table for DeveloperAccountInvite */
export const DeveloperAccountInvite = pgTable(
  'DeveloperAccountInvite',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    developerAccountId: text()
      .notNull()
      .references((): AnyPgColumn => DeveloperAccount.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    emailAddress: text().notNull(),
    accessLevel: text().notNull().default('member'),

    // Status
    failedToSend: boolean().default(false),
    acceptedAt: timestamp({ precision: 3 }),

    // Creator
    createdById: text().notNull(), // { type: 'developer-account-member', id }

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('DeveloperAccountInvite_account_idx').using(
      'btree',
      table.developerAccountId.asc().nullsLast()
    ),
  ]
)
