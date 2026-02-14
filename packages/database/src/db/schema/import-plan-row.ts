// packages/database/src/db/schema/import-plan-row.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  importPlanRowStatus,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { ImportPlanStrategy } from './import-plan-strategy'

/**
 * ImportPlanRow - Row assignment within a strategy
 * Links each CSV row to its planned strategy
 */
export const ImportPlanRow = pgTable(
  'ImportPlanRow',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Parent strategy
    importPlanStrategyId: text()
      .notNull()
      .references((): AnyPgColumn => ImportPlanStrategy.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    // CSV row index (0-based)
    rowIndex: integer().notNull(),

    // For 'update' strategy: ID of the existing record to update
    existingRecordId: text(),

    // Row status
    status: importPlanRowStatus().notNull().default('planned'),

    // After execution: ID of the created/updated record
    resultRecordId: text(),

    // If execution failed, the error message
    errorMessage: text(),

    // Execution timestamp
    executedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('ImportPlanRow_importPlanStrategyId_idx').using(
      'btree',
      table.importPlanStrategyId.asc().nullsLast()
    ),
    index('ImportPlanRow_status_idx').using('btree', table.status.asc().nullsLast()),
    uniqueIndex('ImportPlanRow_strategyId_rowIndex_key').using(
      'btree',
      table.importPlanStrategyId.asc().nullsLast(),
      table.rowIndex.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ImportPlanRow table */
export type ImportPlanRowEntity = typeof ImportPlanRow.$inferSelect

/** Type for inserting into ImportPlanRow table */
export type ImportPlanRowInsert = typeof ImportPlanRow.$inferInsert
