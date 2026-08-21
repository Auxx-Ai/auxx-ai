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
import {
  isBlankValue,
  keysWithStrategy,
  loadNonBlankFieldKeys,
  parseMergeStrategies,
} from './merge-strategy'

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
  /**
   * Update rows whose payload was EMPTY once the blank-is-absence and
   * merge-strategy rules had been applied. Nothing was written and
   * `updateRecord` was never called, so they are neither `executed` nor
   * `failed`, `planned === executed + failed + noops`.
   */
  noops: number
  /** Rows that imported with at least one execution warning */
  warnings: number
  durationMs: number
}

/** Row warning recorded on an update row that turned out to write nothing. */
const NO_OP_WARNING = 'No changes, every mapped value was blank or withheld by its merge strategy'

/** Per-column policy applied to an UPDATE row's payload. */
export interface UpdatePolicy {
  /** `mergeStrategy: 'ignore'`, the column is create-path only. */
  ignoreKeys: ReadonlySet<string>
  /**
   * `mergeStrategy: 'overwrite'`, the blank-is-absence rule is DISABLED for
   * these keys, so a blank cell DOES clear the stored value. This is the only
   * way to empty a field by import; without it absence-by-default becomes "you
   * can't clear anything".
   */
  overwriteKeys: ReadonlySet<string>
  /**
   * `mergeStrategy: 'fill_blank'` keys whose TARGET already holds a value on
   * this record, withheld so a human's value is not clobbered.
   */
  filledKeys: ReadonlySet<string>
}

/** One row's terminal outcome, as written back to `ImportPlanRow`. */
interface PlanRowUpdate {
  id: string
  status: 'completed' | 'failed'
  /** Bare instance id, or null to leave whatever is already stored. */
  resultRecordId: string | null
  /** Failure message, or null to leave whatever is already stored. */
  errorMessage: string | null
  /** Execution warning to APPEND, or null when the row produced none. */
  warningMessage: string | null
}

/**
 * Write a batch of row outcomes in ONE statement.
 *
 * The per-row form issued one UPDATE per imported row, serially, inside the
 * 50-row loop: 5,000 rows meant 5,000 round trips on top of the CRUD writes.
 *
 * Two semantics from the per-row form are preserved exactly, and both are the
 * reason this is a `FROM (VALUES ...)` join rather than a plain multi-row write:
 *
 * - `COALESCE(v.col, r.col)` reproduces Drizzle's undefined-skipping. A row that
 *   succeeded carries no `errorMessage` and a `skip` row carries no
 *   `resultRecordId`; neither column may be stomped to NULL just because this
 *   outcome has nothing to say about it.
 * - `warningMessage` is APPENDED, never replaced. A row can already carry a
 *   PLANNING warning (dropped split elements), and execution warnings join it
 *   with '; '.
 */
async function flushPlanRowUpdates(db: Database, updates: PlanRowUpdate[]): Promise<void> {
  if (updates.length === 0) return

  const now = new Date()
  const tuples = updates.map(
    (u) =>
      sql`(${u.id}::text, ${u.status}::"ImportPlanRowStatus", ${u.resultRecordId}::text, ${u.errorMessage}::text, ${u.warningMessage}::text)`
  )

  // The table is named literally, not interpolated as a Drizzle table object:
  // under vitest the schema proxy does not round-trip as a `Table` chunk and
  // the name silently compiles to a bind parameter instead.
  await db.execute(sql`
    UPDATE "ImportPlanRow" AS r
    SET status = v.status,
        "resultRecordId" = COALESCE(v."resultRecordId", r."resultRecordId"),
        "errorMessage" = COALESCE(v."errorMessage", r."errorMessage"),
        "warningMessage" = CASE
          WHEN v."warningMessage" IS NULL THEN r."warningMessage"
          WHEN r."warningMessage" IS NULL THEN v."warningMessage"
          ELSE r."warningMessage" || '; ' || v."warningMessage"
        END,
        "executedAt" = ${now},
        "updatedAt" = ${now}
    FROM (VALUES ${sql.join(tuples, sql`, `)})
      AS v(id, status, "resultRecordId", "errorMessage", "warningMessage")
    WHERE r.id = v.id
  `)
}

/**
 * Apply the UPDATE-path write policy to one row's payload.
 *
 * **A blank cell is an ABSENCE on update, not a value.** A blank scalar cell
 * used to write `''` over whatever was stored, so a supplier list that leaves
 * `Lead Time` empty on half its rows blanked out lead times someone entered by
 * hand. Most re-imports are partial files, so that is the common case, not the
 * edge one. Create is unaffected, a blank on create is just an unset field.
 *
 * Two different questions compose here: `fill_blank` asks whether the TARGET
 * is empty, the blank rule asks whether the SOURCE is.
 */
export function stripBlankValues(
  fields: Record<string, unknown>,
  policy: UpdatePolicy
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (policy.ignoreKeys.has(key)) continue
    if (policy.filledKeys.has(key)) continue
    if (isBlankValue(value) && !policy.overwriteKeys.has(key)) continue
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
  let noops = 0

  // Per-column merge policy. Read once per strategy, it is mapping metadata,
  // not row data.
  const isUpdate = strategy.strategy === 'update'
  const mergeByKey = parseMergeStrategies(mappings)
  const ignoreKeys = new Set(keysWithStrategy(mergeByKey, 'ignore'))
  const overwriteKeys = new Set(keysWithStrategy(mergeByKey, 'overwrite'))
  const fillBlankKeys = keysWithStrategy(mergeByKey, 'fill_blank')

  // Process in batches
  for (let batchStart = 0; batchStart < planRows.length; batchStart += BATCH_SIZE) {
    const batchRows = planRows.slice(batchStart, batchStart + BATCH_SIZE)
    const rowIndices = batchRows.map((r) => r.rowIndex)

    // Fetch raw data for batch
    const rawData = await getBatchRowData(db, jobId, rowIndices)

    // `fill_blank` needs the CURRENT values, read once per batch, never per
    // row. Only the update path can have a target to protect.
    const nonBlankByInstance =
      isUpdate && fillBlankKeys.length > 0
        ? await loadNonBlankFieldKeys(
            db,
            ctx.organizationId,
            ctx.entityDefinitionId,
            batchRows
              .map((r) => r.existingRecordId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
            fillBlankKeys
          )
        : new Map<string, Set<string>>()

    // Build batch records
    const batchRecords: BatchRecord[] = []
    const noOpRows: typeof batchRows = []

    for (const row of batchRows) {
      const rowData = rawData.get(row.rowIndex) || {}
      let { standardFields, customFields } = buildRecordData(rowData, mappings, resolutions)

      if (isUpdate) {
        const policy = {
          ignoreKeys,
          overwriteKeys,
          filledKeys: nonBlankByInstance.get(row.existingRecordId ?? '') ?? new Set<string>(),
        }
        standardFields = stripBlankValues(standardFields, policy)
        customFields = stripBlankValues(customFields, policy)

        // Nothing survived the policy ⇒ this row writes nothing. Calling
        // `updateRecord` anyway would produce an empty write, a manifest entry
        // and a `toUpdate` count for a row that changed nothing.
        if (Object.keys(standardFields).length === 0 && Object.keys(customFields).length === 0) {
          noOpRows.push(row)
          continue
        }
      }

      batchRecords.push({
        rowIndex: row.rowIndex,
        planRowId: row.id,
        existingRecordId: row.existingRecordId ?? undefined,
        data: { standardFields, customFields, modes: fieldModes },
      })
    }

    // Close out the no-ops: completed, unwritten, warned, and not counted as
    // executed. They still reach a terminal ImportPlanRow status so the plan
    // stays fully accounted for.
    await flushPlanRowUpdates(
      db,
      noOpRows.map((row) => ({
        id: row.id,
        status: 'completed' as const,
        resultRecordId: null,
        errorMessage: null,
        warningMessage: NO_OP_WARNING,
      }))
    )

    for (const row of noOpRows) {
      noops++
      warned++
      await onRowWarning?.(row.rowIndex, NO_OP_WARNING)
    }

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

    // Update plan row statuses, one statement for the whole batch.
    const rowUpdates: PlanRowUpdate[] = []
    for (const rowResult of result.results) {
      const planRow = batchRows.find((r) => r.rowIndex === rowResult.rowIndex)
      if (!planRow) continue
      rowUpdates.push({
        id: planRow.id,
        status: rowResult.success ? 'completed' : 'failed',
        // The column has always held the bare instance id.
        // `rowResult.recordId` is the branded `<defId>:<instanceId>` form,
        // so read `instanceId` to keep the persisted value unchanged.
        resultRecordId: rowResult.instanceId ?? null,
        errorMessage: rowResult.error ?? null,
        // Append execution warnings after any planning warning already on the row.
        warningMessage: rowResult.warning ?? null,
      })
    }

    await flushPlanRowUpdates(db, rowUpdates)

    for (const rowResult of result.results) {
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
      processed: executed + failed + noops,
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
    noops,
    warnings: warned,
    durationMs: Date.now() - startTime,
  }
}
