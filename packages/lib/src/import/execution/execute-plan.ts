// packages/lib/src/import/execution/execute-plan.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { ExecutionProgress, ExecutionResult, FieldWriteModes } from '../types/execution'
import type { ImportMappingProperty } from '../types/mapping'
import type { ImportPlan, ImportPlanStrategy } from '../types/plan'
import type { ValueResolution } from '../types/resolution'
import type { BatchRecordData } from './execute-batch'
import { type ExecuteStrategyContext, executeStrategy } from './execute-strategy'

/** Options for executing a plan */
export interface ExecutePlanOptions {
  db: Database
  organizationId: string
  userId: string
  jobId: string
  plan: ImportPlan
  entityDefinitionId: string
  mappings: ImportMappingProperty[]
  resolutions: Map<string, ValueResolution>
  /**
   * Per-field write mode keyed by data key (customFieldId or targetFieldKey).
   * Multi-value scalar targets carry `'add'` (append-as-alias); unlisted
   * fields default to `'set'`.
   */
  fieldModes?: FieldWriteModes
  /** Data keys of the identifier mapping (degrade-to-update on create conflicts) */
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

/**
 * Execute an import plan.
 *
 * @param options - Execution options
 * @returns Execution result
 */
export async function executePlan(options: ExecutePlanOptions): Promise<ExecutionResult> {
  const { db, plan, onProgress } = options
  const startTime = Date.now()

  // Mark plan as executing
  await db
    .update(schema.ImportPlan)
    .set({ status: 'executing', updatedAt: new Date() })
    .where(eq(schema.ImportPlan.id, plan.id))

  // Get all strategies for this plan
  const strategies = await db.query.ImportPlanStrategy.findMany({
    where: eq(schema.ImportPlanStrategy.importPlanId, plan.id),
    orderBy: asc(schema.ImportPlanStrategy.createdAt),
  })

  let totalCreated = 0
  let totalUpdated = 0
  let totalSkipped = 0
  let totalUnmatched = 0
  let totalNoOps = 0
  let totalFailed = 0
  let totalWarnings = 0
  const errors: Array<{ rowIndex: number; error: string }> = []

  // Execute each strategy in order: create, update, skip, unmatched.
  // Neither `skip` nor `unmatched` writes anything, `executeBatch` treats both
  // as no-op successes, but they still walk their rows so every ImportPlanRow
  // reaches a terminal status.
  const strategyOrder = ['create', 'update', 'skip', 'unmatched'] as const
  const sortedStrategies = strategies.sort(
    (a, b) =>
      strategyOrder.indexOf(a.strategy as (typeof strategyOrder)[number]) -
      strategyOrder.indexOf(b.strategy as (typeof strategyOrder)[number])
  )

  for (const strategy of sortedStrategies) {
    const ctx: ExecuteStrategyContext = {
      db: options.db,
      organizationId: options.organizationId,
      userId: options.userId,
      jobId: options.jobId,
      entityDefinitionId: options.entityDefinitionId,
      mappings: options.mappings,
      resolutions: options.resolutions,
      fieldModes: options.fieldModes,
      identifierKeys: options.identifierKeys,
      createRecord: options.createRecord,
      updateRecord: options.updateRecord,
      onProgress,
      onRowWarning: options.onRowWarning,
    }

    const result = await executeStrategy(strategy as ImportPlanStrategy, ctx)

    // Aggregate results
    if (strategy.strategy === 'create') {
      totalCreated += result.executed
    } else if (strategy.strategy === 'update') {
      // `executed` already excludes rows whose payload was empty after the
      // blank/merge rules, those wrote nothing and are reported as no-ops.
      totalUpdated += result.executed
    } else if (strategy.strategy === 'skip') {
      totalSkipped += result.executed
    } else if (strategy.strategy === 'unmatched') {
      // Kept out of `skipped`: "no matching record in update-only mode" is
      // not a row error, and one badge for both hides a whole class of
      // unimported rows behind a normal-looking state. Never counted as failed.
      totalUnmatched += result.executed
    }

    totalNoOps += result.noops
    totalFailed += result.failed
    totalWarnings += result.warnings

    // Collect errors from failed rows. The `errorMessage IS NOT NULL` arm is
    // load-bearing, not cosmetic: without it a 100k-row import pulls all 100k
    // plan rows into the worker to extract (typically) zero errors. Served by
    // `ImportPlanRow_importPlanStrategyId_idx`.
    const failedRows = await db.query.ImportPlanRow.findMany({
      where: and(
        eq(schema.ImportPlanRow.importPlanStrategyId, strategy.id),
        isNotNull(schema.ImportPlanRow.errorMessage)
      ),
      columns: { rowIndex: true, errorMessage: true },
    })

    for (const row of failedRows) {
      if (row.errorMessage) {
        errors.push({ rowIndex: row.rowIndex, error: row.errorMessage })
      }
    }
  }

  const durationMs = Date.now() - startTime

  // Determine final status
  const allSucceeded = totalFailed === 0
  const allFailed =
    totalCreated + totalUpdated + totalSkipped + totalUnmatched + totalNoOps === 0 &&
    totalFailed > 0

  const status = allFailed ? 'failed' : allSucceeded ? 'completed' : 'partial'

  // Mark plan as completed
  await db
    .update(schema.ImportPlan)
    .set({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportPlan.id, plan.id))

  return {
    planId: plan.id,
    status,
    statistics: {
      created: totalCreated,
      updated: totalUpdated,
      skipped: totalSkipped,
      unmatched: totalUnmatched,
      noOps: totalNoOps,
      failed: totalFailed,
      warnings: totalWarnings,
    },
    errors,
    durationMs,
  }
}
