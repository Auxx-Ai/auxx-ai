// packages/lib/src/import/execution/execute-strategy.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getBatchRowData } from '../raw-data/get-row-data'
import type { ExecutionProgress, FieldWriteModes } from '../types/execution'
import type { ImportMappingProperty } from '../types/mapping'
import type { ImportPlanStrategy, StrategyType } from '../types/plan'
import type { ValueResolution } from '../types/resolution'
import { buildRecordData } from './build-record-data'
import {
  type BatchRecord,
  type BatchRecordData,
  type ExecuteBatchContext,
  executeBatch,
} from './execute-batch'

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
  /**
   * Per-field write mode keyed by data key (customFieldId or targetFieldKey).
   * Multi-value scalar targets carry `'add'` so import appends-as-alias
   * instead of whole-field-setting; unlisted fields default to `'set'`.
   */
  fieldModes?: FieldWriteModes
  /** Data keys of the identifier mapping (see ExecuteBatchContext) */
  identifierKeys?: string[]
  /** Function to create a single record */
  createRecord: (data: BatchRecordData) => Promise<{ id: string }>
  /** Function to update a single record */
  updateRecord: (id: string, data: BatchRecordData) => Promise<{ id: string }>
  /** Progress callback */
  onProgress?: (progress: ExecutionProgress) => void
  /** Called when a row imports with a non-fatal warning */
  onRowWarning?: (rowIndex: number, warning: string) => void | Promise<void>
}

/** Strategy execution result */
export interface StrategyExecutionResult {
  strategyId: string
  strategy: StrategyType
  executed: number
  failed: number
  /** Rows that imported with at least one execution warning */
  warnings: number
  durationMs: number
}

/** True for null / empty-string / empty-array resolved values. */
function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * On UPDATE rows, a blank cell on a multi-value field is a NO-WRITE — the key
 * is removed entirely. Without this a blank email cell in a re-import CLEARS
 * the stored alias list (mode `'add'` with `null` would still be a write, and
 * historic `'set'` behavior wiped the field outright).
 */
export function stripBlankMultiValues(
  fields: Record<string, unknown>,
  modes: FieldWriteModes | undefined
): Record<string, unknown> {
  if (!modes) return fields
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (modes[key] === 'add' && isBlankValue(value)) continue
    result[key] = value
  }
  return result
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
  const {
    db,
    jobId,
    mappings,
    resolutions,
    fieldModes,
    createRecord,
    updateRecord,
    onProgress,
    onRowWarning,
  } = ctx
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
  let warned = 0

  // Process in batches
  for (let batchStart = 0; batchStart < planRows.length; batchStart += BATCH_SIZE) {
    const batchRows = planRows.slice(batchStart, batchStart + BATCH_SIZE)
    const rowIndices = batchRows.map((r) => r.rowIndex)

    // Fetch raw data for batch
    const rawData = await getBatchRowData(db, jobId, rowIndices)

    // Build batch records
    const batchRecords: BatchRecord[] = batchRows.map((row) => {
      const rowData = rawData.get(row.rowIndex) || {}
      let { standardFields, customFields } = buildRecordData(rowData, mappings, resolutions)

      if (strategy.strategy === 'update') {
        standardFields = stripBlankMultiValues(standardFields, fieldModes)
        customFields = stripBlankMultiValues(customFields, fieldModes)
      }

      return {
        rowIndex: row.rowIndex,
        planRowId: row.id,
        existingRecordId: row.existingRecordId ?? undefined,
        data: { standardFields, customFields, modes: fieldModes },
      }
    })

    // Execute batch
    const batchCtx: ExecuteBatchContext = {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      entityDefinitionId: ctx.entityDefinitionId,
      strategy: strategy.strategy,
      identifierKeys: ctx.identifierKeys,
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
            // The column has always held the bare instance id.
            // `rowResult.recordId` is the branded `<defId>:<instanceId>` form,
            // so read `instanceId` to keep the persisted value unchanged.
            resultRecordId: rowResult.instanceId,
            errorMessage: rowResult.error,
            // Append execution warnings after any planning warning already on the row.
            ...(rowResult.warning
              ? {
                  warningMessage: sql`CASE WHEN ${schema.ImportPlanRow.warningMessage} IS NULL THEN ${rowResult.warning} ELSE ${schema.ImportPlanRow.warningMessage} || '; ' || ${rowResult.warning} END`,
                }
              : {}),
            executedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.ImportPlanRow.id, planRow.id))
      }

      if (rowResult.warning) {
        warned++
        await onRowWarning?.(rowResult.rowIndex, rowResult.warning)
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
    warnings: warned,
    durationMs: Date.now() - startTime,
  }
}
