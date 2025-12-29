// packages/lib/src/import/execution/execute-row.ts

import { eq } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { RowExecutionResult } from '../types/execution'
import type { StrategyType } from '../types/plan'

/** Context for executing a single row */
export interface ExecuteRowContext {
  db: Database
  organizationId: string
  userId: string
  targetTable: string
  strategy: StrategyType
  planRowId: string
  existingRecordId?: string
  /** Function to create a new record */
  createRecord: (data: {
    standardFields: Record<string, unknown>
    customFields: Record<string, unknown>
  }) => Promise<{ id: string }>
  /** Function to update an existing record */
  updateRecord: (
    id: string,
    data: {
      standardFields: Record<string, unknown>
      customFields: Record<string, unknown>
    }
  ) => Promise<{ id: string }>
}

/**
 * Execute a single row operation (create or update).
 *
 * @param rowIndex - Row index
 * @param recordData - Record data (standard and custom fields)
 * @param ctx - Execution context
 * @returns Execution result
 */
export async function executeRow(
  rowIndex: number,
  recordData: {
    standardFields: Record<string, unknown>
    customFields: Record<string, unknown>
  },
  ctx: ExecuteRowContext
): Promise<RowExecutionResult> {
  const { db, strategy, planRowId, existingRecordId, createRecord, updateRecord } = ctx

  try {
    // Update plan row status to executing
    await db
      .update(schema.ImportPlanRow)
      .set({ status: 'executing', updatedAt: new Date() })
      .where(eq(schema.ImportPlanRow.id, planRowId))

    let resultId: string

    if (strategy === 'create') {
      const result = await createRecord(recordData)
      resultId = result.id
    } else if (strategy === 'update' && existingRecordId) {
      const result = await updateRecord(existingRecordId, recordData)
      resultId = result.id
    } else {
      // Skip strategy - just mark as completed
      await db
        .update(schema.ImportPlanRow)
        .set({
          status: 'completed',
          executedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.ImportPlanRow.id, planRowId))

      return { rowIndex, success: true }
    }

    // Mark plan row as completed
    await db
      .update(schema.ImportPlanRow)
      .set({
        status: 'completed',
        resultRecordId: resultId,
        executedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.ImportPlanRow.id, planRowId))

    return { rowIndex, success: true, recordId: resultId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Mark plan row as failed
    await db
      .update(schema.ImportPlanRow)
      .set({
        status: 'failed',
        errorMessage,
        executedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.ImportPlanRow.id, planRowId))

    return { rowIndex, success: false, error: errorMessage }
  }
}
