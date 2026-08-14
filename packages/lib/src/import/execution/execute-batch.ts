// packages/lib/src/import/execution/execute-batch.ts

import { createScopedLogger } from '@auxx/logger'
import { UniqueValueConflictError } from '../../errors'
import type { BatchExecutionResult, FieldWriteModes, RowExecutionResult } from '../types/execution'
import type { StrategyType } from '../types/plan'
import { buildImportRecordId } from '../utils/resource-id'

const logger = createScopedLogger('execute-batch')

/** Record data shape passed to create/update callbacks */
export interface BatchRecordData {
  standardFields: Record<string, unknown>
  customFields: Record<string, unknown>
  /**
   * Per-field write mode, keyed the same way the field is keyed in
   * `standardFields`/`customFields`. Multi-value scalar targets carry `'add'`
   * (append-as-alias); everything else defaults to `'set'`.
   */
  modes?: FieldWriteModes
}

/** Record to execute in a batch */
export interface BatchRecord {
  rowIndex: number
  planRowId: string
  existingRecordId?: string
  data: BatchRecordData
}

/** Context for executing a batch */
export interface ExecuteBatchContext {
  organizationId: string
  userId: string
  entityDefinitionId: string
  strategy: StrategyType
  /**
   * Data keys (customFieldId or targetFieldKey) belonging to the import's
   * identifier mapping. A uniqueness conflict on one of these during a
   * `create` degrades the row to update-by-append on the record that owns
   * the value (in-file duplicate identifiers, planning misses).
   */
  identifierKeys?: string[]
  /** Function to create records in bulk (if available) */
  bulkCreate?: (records: Array<BatchRecordData>) => Promise<Array<{ id: string }>>
  /** Function to create a single record */
  createRecord: (data: BatchRecordData) => Promise<{ id: string }>
  /** Function to update a single record */
  updateRecord: (id: string, data: BatchRecordData) => Promise<{ id: string }>
  /** Progress callback */
  onProgress?: (processed: number, total: number) => void
}

/** Case-insensitive equality for conflict-value matching. */
function sameValue(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
}

/**
 * Remove `conflictingValue` from whichever field carries it. Returns the data
 * key it was removed from, or null when the value is nowhere to be found
 * (in which case the caller must rethrow — retrying would loop forever).
 */
function dropConflictingValue(data: BatchRecordData, conflictingValue: string): string | null {
  for (const bucket of [data.customFields, data.standardFields]) {
    for (const [key, value] of Object.entries(bucket)) {
      if (Array.isArray(value)) {
        if (value.some((v) => sameValue(v, conflictingValue))) {
          const remaining = value.filter((v) => !sameValue(v, conflictingValue))
          if (remaining.length > 0) {
            bucket[key] = remaining
          } else {
            delete bucket[key]
          }
          return key
        }
      } else if (sameValue(value, conflictingValue)) {
        delete bucket[key]
        return key
      }
    }
  }
  return null
}

/**
 * Execute one record with per-value uniqueness-conflict recovery.
 *
 * `UniqueValueConflictError` (thrown by the contact email hooks for a value
 * already owned by ANOTHER record) is handled per value:
 * - conflict on the IDENTIFIER field of a `create` row whose error names the
 *   owning record → degrade to update-by-append on that record (in-file
 *   duplicate emails, rows the planner could not match),
 * - any other conflict → drop the offending value with a row warning and
 *   retry — the row still imports.
 */
async function executeRecordWithRecovery(
  record: BatchRecord,
  ctx: ExecuteBatchContext
): Promise<{ id: string | undefined; warnings: string[] }> {
  const { strategy, createRecord, updateRecord } = ctx
  const warnings: string[] = []

  // Work on a shallow copy so recovery mutations don't leak into the caller.
  const data: BatchRecordData = {
    standardFields: { ...record.data.standardFields },
    customFields: { ...record.data.customFields },
    modes: record.data.modes,
  }

  let degradedToRecordId: string | undefined

  // Bounded by the number of values a row can carry; each retry removes one.
  const maxAttempts = 12
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (strategy === 'create' && !degradedToRecordId) {
        const result = await createRecord(data)
        return { id: result.id, warnings }
      }
      const targetId = degradedToRecordId ?? record.existingRecordId
      if (!targetId) {
        logger.warn('Update strategy but no existingRecordId', { rowIndex: record.rowIndex })
        return { id: undefined, warnings }
      }
      const result = await updateRecord(targetId, data)
      return { id: result.id, warnings }
    } catch (error) {
      if (!(error instanceof UniqueValueConflictError)) throw error

      const value = error.conflictingValue

      // Locate the offending value first — its data key tells us whether the
      // conflict is on the identifier mapping.
      const probe: BatchRecordData = {
        standardFields: { ...data.standardFields },
        customFields: { ...data.customFields },
      }
      const conflictKey = dropConflictingValue(probe, value)
      if (conflictKey === null) {
        // Value not in our payload — nothing to drop, retrying would loop.
        throw error
      }

      const isIdentifierConflict = ctx.identifierKeys?.includes(conflictKey) ?? false

      if (
        strategy === 'create' &&
        !degradedToRecordId &&
        isIdentifierConflict &&
        error.existingEntityId
      ) {
        // The identifier value already belongs to a record (same file, earlier
        // row, or a planning miss) — this IS that record. Append instead of
        // failing; add-mode dedup makes the shared value a no-op.
        degradedToRecordId = error.existingEntityId
        warnings.push(`Merged into existing record: "${value}" already belongs to it`)
        continue
      }

      // Drop the value for real and retry without it.
      data.standardFields = probe.standardFields
      data.customFields = probe.customFields
      warnings.push(`Dropped "${value}" — already used by another record`)
    }
  }

  throw new Error(`Row ${record.rowIndex}: conflict recovery did not converge`)
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

  const { strategy, onProgress } = ctx

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
            instanceId: created.id,
            recordId: buildImportRecordId(ctx.entityDefinitionId, created.id),
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
    } catch {
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
      let warning: string | undefined

      if (strategy === 'create' || strategy === 'update') {
        const outcome = await executeRecordWithRecovery(record, ctx)
        resultId = outcome.id
        if (outcome.warnings.length > 0) warning = outcome.warnings.join('; ')
      }
      // Skip strategy doesn't need to do anything

      results.push({
        rowIndex: record.rowIndex,
        success: true,
        instanceId: resultId,
        // `skip` (and an `update` with no existing record) leaves `resultId` unset.
        recordId: resultId ? buildImportRecordId(ctx.entityDefinitionId, resultId) : undefined,
        warning,
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
