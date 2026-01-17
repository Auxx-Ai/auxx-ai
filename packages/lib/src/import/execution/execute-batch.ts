// packages/lib/src/import/execution/execute-batch.ts

import { createScopedLogger } from '@auxx/logger'
import type { BatchExecutionResult, RowExecutionResult } from '../types/execution'
import type { StrategyType } from '../types/plan'

const logger = createScopedLogger('execute-batch')

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
  entityDefinitionId: string
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

  logger.debug('executeBatch started', {
    strategy,
    recordCount: records.length,
    entityDefinitionId: ctx.entityDefinitionId,
    sampleRecord: records[0]
      ? {
          rowIndex: records[0].rowIndex,
          hasExistingRecordId: !!records[0].existingRecordId,
          existingRecordId: records[0].existingRecordId,
        }
      : null,
  })

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

    logger.debug('Processing record', {
      index: i,
      rowIndex: record.rowIndex,
      strategy,
      hasExistingRecordId: !!record.existingRecordId,
      existingRecordId: record.existingRecordId,
    })

    try {
      let resultId: string | undefined

      if (strategy === 'create') {
        logger.debug('Calling createRecord', { rowIndex: record.rowIndex })
        const result = await createRecord(record.data)
        resultId = result.id
      } else if (strategy === 'update') {
        if (record.existingRecordId) {
          logger.debug('Calling updateRecord', {
            rowIndex: record.rowIndex,
            existingRecordId: record.existingRecordId,
          })
          const result = await updateRecord(record.existingRecordId, record.data)
          resultId = result.id
        } else {
          logger.warn('Update strategy but no existingRecordId', { rowIndex: record.rowIndex })
        }
      }
      // Skip strategy doesn't need to do anything

      results.push({
        rowIndex: record.rowIndex,
        success: true,
        recordId: resultId,
      })
      succeeded++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Record execution failed', {
        rowIndex: record.rowIndex,
        strategy,
        existingRecordId: record.existingRecordId,
        error: errorMessage,
      })
      results.push({
        rowIndex: record.rowIndex,
        success: false,
        error: errorMessage,
      })
      failed++
    }

    onProgress?.(i + 1, records.length)
  }

  return { succeeded, failed, results }
}
