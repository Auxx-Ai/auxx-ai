// packages/lib/src/import/planning/assign-row-to-strategy.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportPlanRow } from '../types/plan'

/** Input for assigning a row to a strategy */
export interface AssignRowInput {
  strategyId: string
  rowIndex: number
  existingRecordId?: string
  /** Non-fatal planning issues (dropped split elements) — joined with '; ' */
  warningMessage?: string
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
      warningMessage: input.warningMessage,
      status: 'planned',
      updatedAt: new Date(),
    })
    .returning()

  if (!result) {
    throw new Error('Failed to assign import row to strategy')
  }

  return {
    id: result.id,
    importPlanStrategyId: result.importPlanStrategyId,
    rowIndex: result.rowIndex,
    existingRecordId: result.existingRecordId ?? undefined,
    status: result.status as ImportPlanRow['status'],
    resultRecordId: result.resultRecordId ?? undefined,
    errorMessage: result.errorMessage ?? undefined,
    warningMessage: result.warningMessage ?? undefined,
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
      warningMessage: a.warningMessage,
      status: 'planned' as const,
      updatedAt: now,
    }))
  )
}
