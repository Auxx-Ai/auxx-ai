// packages/database/src/db/schema/app-marketplace-image.ts
// Drizzle table for app marketplace image

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp } from './_shared'
import { App } from './app'
import { DeveloperAccount } from './developer-account'

/** Drizzle table for AppMarketplaceImage */
export const AppMarketplaceImage = pgTable(
  'AppMarketplaceImage',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    developerAccountId: text()
      .notNull()
      .references((): AnyPgColumn => DeveloperAccount.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // File info
    fileExtension: text().notNull(), // png, jpg
    sortOrder: text(),
    savedSortOrder: text(),

    // Upload status
    uploadCompletedAt: timestamp({ precision: 3 }),
    lastSavedAt: timestamp({ precision: 3 }),
    archivedAt: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [index('AppMarketplaceImage_appId_idx').using('btree', table.appId.asc().nullsLast())]
)
