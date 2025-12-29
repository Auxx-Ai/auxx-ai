// packages/database/src/db/schema/import-plan-strategy.ts

import {
  pgTable,
  index,
  text,
  timestamp,
  jsonb,
  type AnyPgColumn,
  importStrategyStatus,
  importStrategyType,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { ImportPlan } from './import-plan'
import { CustomField } from './custom-field'

/**
 * ImportPlanStrategy - Strategy within a plan
 * Groups rows by their action (create, update, skip)
 */
export const ImportPlanStrategy = pgTable(
  'ImportPlanStrategy',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Parent plan
    importPlanId: text()
      .notNull()
      .references((): AnyPgColumn => ImportPlan.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Strategy type
    strategy: importStrategyType().notNull(),

    // For 'update' strategy: the field used to match existing records
    matchingFieldKey: text(),
    matchingCustomFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // Strategy status
    status: importStrategyStatus().notNull().default('planning_queued'),

    // Planning progress (JSON): { total, processed, remaining }
    planningProgress: jsonb(),

    // Execution statistics (JSON): { planned, executed, failed }
    statistics: jsonb(),

    // Timestamps
    planningStartedAt: timestamp({ precision: 3 }),
    planningCompletedAt: timestamp({ precision: 3 }),
    executionStartedAt: timestamp({ precision: 3 }),
    executionCompletedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('ImportPlanStrategy_importPlanId_idx').using(
      'btree',
      table.importPlanId.asc().nullsLast()
    ),
    index('ImportPlanStrategy_strategy_idx').using('btree', table.strategy.asc().nullsLast()),
  ]
)

/** Type for selecting from ImportPlanStrategy table */
export type ImportPlanStrategyEntity = typeof ImportPlanStrategy.$inferSelect

/** Type for inserting into ImportPlanStrategy table */
export type ImportPlanStrategyInsert = typeof ImportPlanStrategy.$inferInsert
