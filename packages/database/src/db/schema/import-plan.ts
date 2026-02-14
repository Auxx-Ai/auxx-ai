// packages/database/src/db/schema/import-plan.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, importPlanStatus, index, pgTable, text, timestamp } from './_shared'
import { ImportJob } from './import-job'

/**
 * ImportPlan - Import plan record
 * Created after mappings are complete, before execution
 */
export const ImportPlan = pgTable(
  'ImportPlan',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Parent job
    importJobId: text()
      .notNull()
      .references((): AnyPgColumn => ImportJob.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Plan status
    status: importPlanStatus().notNull().default('planning'),

    // Completion timestamp
    completedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('ImportPlan_importJobId_idx').using('btree', table.importJobId.asc().nullsLast()),
    index('ImportPlan_status_idx').using('btree', table.status.asc().nullsLast()),
  ]
)

/** Type for selecting from ImportPlan table */
export type ImportPlanEntity = typeof ImportPlan.$inferSelect

/** Type for inserting into ImportPlan table */
export type ImportPlanInsert = typeof ImportPlan.$inferInsert
