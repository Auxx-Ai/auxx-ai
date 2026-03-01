// packages/database/src/db/schema/app-bundle.ts
// Content-addressed bundle storage. Each row represents a unique, immutable JS file in S3.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { App } from './app'

/** Drizzle table for AppBundle */
export const AppBundle = pgTable(
  'AppBundle',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    bundleType: text().notNull(), // 'client' | 'server'
    sha256: text().notNull(),
    sizeBytes: integer(), // null until upload completes
    uploadedAt: timestamp({ precision: 3 }), // null = hash registered but not yet uploaded
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('AppBundle_content_idx').on(table.appId, table.bundleType, table.sha256),
    index('AppBundle_appId_idx').on(table.appId),
  ]
)
