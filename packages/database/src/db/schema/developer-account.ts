// packages/database/src/db/schema/developer-account.ts
// Drizzle table for developer account

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'

/** Drizzle table for DeveloperAccount */
export const DeveloperAccount = pgTable(
  'DeveloperAccount',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    slug: text().unique().notNull(),
    title: text().notNull(),

    // Logo
    logoId: text(),
    logoUrl: text(),

    // Feature flags
    featureFlags: jsonb().$type<Record<string, boolean>>().default({
      'legacy-collection-scopes': false,
      'search-records-api': false,
      'find-create-meetings-api': false,
      'get-list-meetings-api': true,
      'write-call-recordings-api': false,
      'read-call-recordings-api': true,
    }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('DeveloperAccount_slug_idx').using('btree', table.slug.asc().nullsLast())]
)
