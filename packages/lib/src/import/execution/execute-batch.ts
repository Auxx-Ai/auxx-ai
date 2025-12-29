// packages/lib/src/import/execution/execute-batch.ts

import type { BatchExecutionResult, RowExecutionResult } from '../types/execution'
import type { StrategyType } from '../types/plan'

/** Record to execute in a batch */
export interface BatchRecord {
  rowIndex: number
  planRowId: string
  existingRecordId?: string
  data: {
    standardFields: Record<string, unknown>
    customFields: Record<string, unknown>
  }
}

/** Context for executing a batch */
export interface ExecuteBatchContext {
  organizationId: string
  userId: string
  targetTable: string
  strategy: StrategyType
  /** Function to create records in bulk (if available) */
  bulkCreate?: (
    records: Array<{
      standardFields: Record<string, unknown>
      customFields: Record<string, unknown>
    }>
  ) => Promise<Array<{ id: string }>>
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
  onProgress?: (processed: number, total: number) => void
}

/**
 * Execute a batch of records.
 *
 * @param records - Records to execute
 * @param ctx - Batch execution context
 * @returns Batch execution result
 */
export async function executeBatch(
  records: BatchRecord[],
  ctx: ExecuteBatchContext
): Promise<BatchExecutionResult> {
  const results: RowExecutionResult[] = []
  let succeeded = 0
  let failed = 0

  const { strategy, createRecord, updateRecord, onProgress } = ctx

  // For create strategy with bulk support, use it
  if (strategy === 'create' && ctx.bulkCreate && records.length > 1) {
    try {
      const createdRecords = await ctx.bulkCreate(records.map((r) => r.data))

      for (let i = 0; i < records.length; i++) {
        const record = records[i]!
        const created = createdRecords[i]

        if (created) {
          results.push({
            rowIndex: record.rowIndex,
            success: true,
            recordId: created.id,
          })
          succeeded++
        } else {
          results.push({
            rowIndex: record.rowIndex,
            success: false,
            error: 'Bulk create returned no result',
          })
          failed++
        }
      }

      onProgress?.(records.length, records.length)
      return { succeeded, failed, results }
    } catch (error) {
      // Bulk failed, fall back to sequential
    }
  }

  // Sequential execution
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!

    try {
      let resultId: string | undefined

      if (strategy === 'create') {
        const result = await createRecord(record.data)
        resultId = result.id
      } else if (strategy === 'update' && record.existingRecordId) {
        const result = await updateRecord(record.existingRecordId, record.data)
        resultId = result.id
      }
      // Skip strategy doesn't need to do anything

      results.push({
        rowIndex: record.rowIndex,
        success: true,
        recordId: resultId,
      })
      succeeded++
    } catch (error) {
      results.push({
        rowIndex: record.rowIndex,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      failed++
    }

    onProgress?.(i + 1, records.length)
  }

  return { succeeded, failed, results }
}
