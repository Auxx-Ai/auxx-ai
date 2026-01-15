// packages/lib/src/import/execution/execute-plan.ts

import { eq, asc } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportPlan, ImportPlanStrategy } from '../types/plan'
import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'
import type { ExecutionResult, ExecutionProgress } from '../types/execution'
import { executeStrategy, type ExecuteStrategyContext } from './execute-strategy'

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
  let totalFailed = 0
  const errors: Array<{ rowIndex: number; error: string }> = []

  // Execute each strategy in order: create, update, skip
  const strategyOrder = ['create', 'update', 'skip'] as const
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
      createRecord: options.createRecord,
      updateRecord: options.updateRecord,
      onProgress,
    }

    const result = await executeStrategy(strategy as ImportPlanStrategy, ctx)

    // Aggregate results
    if (strategy.strategy === 'create') {
      totalCreated += result.executed
    } else if (strategy.strategy === 'update') {
      totalUpdated += result.executed
    } else if (strategy.strategy === 'skip') {
      totalSkipped += result.executed
    }

    totalFailed += result.failed

    // Collect errors from failed rows
    const failedRows = await db.query.ImportPlanRow.findMany({
      where: eq(schema.ImportPlanRow.importPlanStrategyId, strategy.id),
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
  const allFailed = totalCreated + totalUpdated + totalSkipped === 0 && totalFailed > 0

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
      failed: totalFailed,
    },
    errors,
    durationMs,
  }
}
