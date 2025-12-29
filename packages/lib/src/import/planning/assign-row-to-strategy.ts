// packages/lib/src/import/planning/assign-row-to-strategy.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportPlanRow, StrategyType } from '../types/plan'

/** Input for assigning a row to a strategy */
export interface AssignRowInput {
  strategyId: string
  rowIndex: number
  existingRecordId?: string
}

/**
 * Assign a row to a strategy (create plan row record).
 *
 * @param db - Database instance
 * @param input - Row assignment input
 * @returns The created plan row
 */
export async function assignRowToStrategy(
  db: Database,
  input: AssignRowInput
): Promise<ImportPlanRow> {
  const [result] = await db
    .insert(schema.ImportPlanRow)
    .values({
      importPlanStrategyId: input.strategyId,
      rowIndex: input.rowIndex,
      existingRecordId: input.existingRecordId,
      status: 'planned',
      updatedAt: new Date(),
    })
    .returning()

  return {
    id: result.id,
    importPlanStrategyId: result.importPlanStrategyId,
    rowIndex: result.rowIndex,
    existingRecordId: result.existingRecordId ?? undefined,
    status: result.status as ImportPlanRow['status'],
    resultRecordId: result.resultRecordId ?? undefined,
    errorMessage: result.errorMessage ?? undefined,
    executedAt: result.executedAt ?? undefined,
  }
}

/**
 * Batch assign rows to strategies.
 *
 * @param db - Database instance
 * @param assignments - Array of row assignments
 */
export async function batchAssignRows(db: Database, assignments: AssignRowInput[]): Promise<void> {
  if (assignments.length === 0) {
    return
  }

  const now = new Date()

  await db.insert(schema.ImportPlanRow).values(
    assignments.map((a) => ({
      importPlanStrategyId: a.strategyId,
      rowIndex: a.rowIndex,
      existingRecordId: a.existingRecordId,
      status: 'planned' as const,
      updatedAt: now,
    }))
  )
}
