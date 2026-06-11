// packages/database/src/db/schema/data-migration.ts
// Drizzle table: DataMigration — ledger of one-shot data migrations.
// One row per applied/failed migration id. The registry of *available* migrations
// lives in code (@auxx/lib/data-migrations); the DB records only outcomes.

import { integer, pgTable, text, timestamp } from './_shared'

export const DataMigration = pgTable('DataMigration', {
  /** Stable migration id from the code registry, e.g. '024-backfill-foo'. */
  id: text().primaryKey().notNull(),
  /** 'applied' | 'failed' */
  status: text().notNull(),
  error: text(),
  durationMs: integer(),
  appliedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp({ precision: 3 })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
})

export type DataMigrationEntity = typeof DataMigration.$inferSelect
export type DataMigrationInsert = typeof DataMigration.$inferInsert
