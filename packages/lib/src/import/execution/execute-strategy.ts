// packages/lib/src/import/execution/execute-strategy.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { getBatchRowData } from '../raw-data/get-row-data'
import type { ExecutionProgress } from '../types/execution'
import type { ImportMappingProperty } from '../types/mapping'
import type { ImportPlanStrategy, StrategyType } from '../types/plan'
import type { ValueResolution } from '../types/resolution'
import { buildRecordData } from './build-record-data'
import { type BatchRecord, type ExecuteBatchContext, executeBatch } from './execute-batch'

/** Batch size for execution */
const BATCH_SIZE = 50

/** Context for executing a strategy */
export interface ExecuteStrategyContext {
  db: Database
  organizationId: string
  userId: string
  jobId: string
  entityDefinitionId: string
  mappings: ImportMappingProperty[]
  resolutions: Map<string, ValueResolution>
  /** Function to create a single record */
  createRecord: (data: {
    standardFields: Record<string, unknown>
    customFields: Record<string, unknown>
  }) => Promise<{ id: string }>
  /** Function to update a single record */
  updateRecord: (
    id: string,
    data: {
      standardFields: Record<string, unknown>
      customFields: Record<string, unknown>
    }
  ) => Promise<{ id: string }>
  /** Progress callback */
  onProgress?: (progress: ExecutionProgress) => void
}

/** Strategy execution result */
export interface StrategyExecutionResult {
  strategyId: string
  strategy: StrategyType
  executed: number
  failed: number
  durationMs: number
}

/**
 * Execute all rows in a strategy.
 *
 * @param strategy - Strategy to execute
 * @param ctx - Execution context
 * @returns Execution result for the strategy
 */
export async function executeStrategy(
  strategy: ImportPlanStrategy,
  ctx: ExecuteStrategyContext
): Promise<StrategyExecutionResult> {
  const { db, jobId, mappings, resolutions, createRecord, updateRecord, onProgress } = ctx
  const startTime = Date.now()

  // Mark strategy as executing
  await db
    .update(schema.ImportPlanStrategy)
    .set({
      status: 'executing',
      executionStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportPlanStrategy.id, strategy.id))

  // Get all rows for this strategy
  const planRows = await db.query.ImportPlanRow.findMany({
    where: and(
      eq(schema.ImportPlanRow.importPlanStrategyId, strategy.id),
      eq(schema.ImportPlanRow.status, 'planned')
    ),
    orderBy: asc(schema.ImportPlanRow.rowIndex),
    columns: {
      id: true,
      rowIndex: true,
      existingRecordId: true,
    },
  })

  const totalRows = planRows.length
  let executed = 0
  let failed = 0

  // Process in batches
  for (let batchStart = 0; batchStart < planRows.length; batchStart += BATCH_SIZE) {
    const batchRows = planRows.slice(batchStart, batchStart + BATCH_SIZE)
    const rowIndices = batchRows.map((r) => r.rowIndex)

    // Fetch raw data for batch
    const rawData = await getBatchRowData(db, jobId, rowIndices)

    // Build batch records
    const batchRecords: BatchRecord[] = batchRows.map((row) => {
      const rowData = rawData.get(row.rowIndex) || {}
      const { standardFields, customFields } = buildRecordData(rowData, mappings, resolutions)

      return {
        rowIndex: row.rowIndex,
        planRowId: row.id,
        existingRecordId: row.existingRecordId ?? undefined,
        data: { standardFields, customFields },
      }
    })

    // Execute batch
    const batchCtx: ExecuteBatchContext = {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      entityDefinitionId: ctx.entityDefinitionId,
      strategy: strategy.strategy,
      createRecord,
      updateRecord,
    }

    const result = await executeBatch(batchRecords, batchCtx)

    // Update plan row statuses
    for (const rowResult of result.results) {
      const planRow = batchRows.find((r) => r.rowIndex === rowResult.rowIndex)
      if (planRow) {
        await db
          .update(schema.ImportPlanRow)
          .set({
            status: rowResult.success ? 'completed' : 'failed',
            resultRecordId: rowResult.recordId,
            errorMessage: rowResult.error,
            executedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.ImportPlanRow.id, planRow.id))
      }
    }

    executed += result.succeeded
    failed += result.failed

    // Report progress
    onProgress?.({
      phase: 'executing',
      strategyId: strategy.id,
      strategy: strategy.strategy,
      processed: executed + failed,
      total: totalRows,
      succeeded: executed,
      failed,
    })
  }

  // Mark strategy as completed
  await db
    .update(schema.ImportPlanStrategy)
    .set({
      status: 'completed',
      statistics: {
        planned: totalRows,
        executed,
        failed,
      },
      executionCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportPlanStrategy.id, strategy.id))

  return {
    strategyId: strategy.id,
    strategy: strategy.strategy,
    executed,
    failed,
    durationMs: Date.now() - startTime,
  }
}
