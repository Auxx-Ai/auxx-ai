// packages/lib/src/import/planning/get-plan.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { ImportPlanStatus, PlanEstimates } from '../types/plan'

/** Plan with estimates */
export interface PlanWithEstimates {
  id: string
  jobId: string
  status: ImportPlanStatus
  estimates: PlanEstimates
}

function getPlannedCount(statistics: unknown): number {
  if (typeof statistics !== 'object' || statistics === null || Array.isArray(statistics)) {
    return 0
  }

  const planned = (statistics as Record<string, unknown>).planned
  return typeof planned === 'number' && Number.isFinite(planned) && planned >= 0 ? planned : 0
}

/**
 * Get import plan with calculated estimates.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param rowCount - Total row count for estimates
 * @returns Plan with estimates or null if not found
 */
export async function getPlanWithEstimates(
  db: Database,
  jobId: string,
  rowCount: number
): Promise<PlanWithEstimates | null> {
  // Get plan with strategies
  const plan = await db.query.ImportPlan.findFirst({
    where: eq(schema.ImportPlan.importJobId, jobId),
    with: {
      strategies: true,
    },
  })

  if (!plan) {
    return null
  }

  // Calculate estimates from strategies
  // For now, if no row assignments exist, default all to create
  let toCreate = 0
  let toUpdate = 0
  let toSkip = 0
  let withErrors = 0

  for (const strategy of plan.strategies) {
    const count = getPlannedCount(strategy.statistics)
    switch (strategy.strategy) {
      case 'create':
        toCreate = count
        break
      case 'update':
        toUpdate = count
        break
      case 'skip':
        toSkip = count
        withErrors = count
        break
    }
  }

  // If no rows assigned to strategies yet, default all to create
  if (toCreate + toUpdate + toSkip === 0) {
    toCreate = rowCount
  }

  return {
    id: plan.id,
    jobId,
    status: plan.status as ImportPlanStatus,
    estimates: {
      totalRows: rowCount,
      toCreate,
      toUpdate,
      toSkip,
      withErrors,
    },
  }
}

/** Plan error entry */
export interface PlanError {
  rowIndex: number
  error: string
}

/**
 * Get errors from an import plan.
 *
 * @param db - Database instance
 * @param planId - Import plan ID
 * @param limit - Max errors to return (default 10)
 * @returns Array of plan errors
 */
export async function getPlanErrors(
  db: Database,
  planId: string,
  limit: number = 10
): Promise<PlanError[]> {
  // Scope through the strategy join — a bare status filter would return
  // failed rows of EVERY plan in the table.
  const errorRows = await db
    .select({
      rowIndex: schema.ImportPlanRow.rowIndex,
      errorMessage: schema.ImportPlanRow.errorMessage,
    })
    .from(schema.ImportPlanRow)
    .innerJoin(
      schema.ImportPlanStrategy,
      eq(schema.ImportPlanRow.importPlanStrategyId, schema.ImportPlanStrategy.id)
    )
    .where(
      and(
        eq(schema.ImportPlanStrategy.importPlanId, planId),
        eq(schema.ImportPlanRow.status, 'failed')
      )
    )
    .orderBy(schema.ImportPlanRow.rowIndex)
    .limit(limit)

  return errorRows.map((row) => ({
    rowIndex: row.rowIndex,
    error: row.errorMessage ?? 'Unknown error',
  }))
}

/** Plan warning entry */
export interface PlanWarning {
  rowIndex: number
  warning: string
}

/** Warnings from an import plan, with the total count for the summary line. */
export interface PlanWarningsResult {
  total: number
  warnings: PlanWarning[]
}

/**
 * Get non-fatal row warnings from an import plan (dropped split elements,
 * uniqueness conflicts dropped at execution, creates degraded to updates).
 *
 * @param db - Database instance
 * @param planId - Import plan ID
 * @param limit - Max warnings to return (default 10)
 */
export async function getPlanWarnings(
  db: Database,
  planId: string,
  limit: number = 10
): Promise<PlanWarningsResult> {
  const rows = await db
    .select({
      rowIndex: schema.ImportPlanRow.rowIndex,
      warningMessage: schema.ImportPlanRow.warningMessage,
    })
    .from(schema.ImportPlanRow)
    .innerJoin(
      schema.ImportPlanStrategy,
      eq(schema.ImportPlanRow.importPlanStrategyId, schema.ImportPlanStrategy.id)
    )
    .where(
      and(
        eq(schema.ImportPlanStrategy.importPlanId, planId),
        isNotNull(schema.ImportPlanRow.warningMessage)
      )
    )
    .orderBy(schema.ImportPlanRow.rowIndex)

  return {
    total: rows.length,
    warnings: rows.slice(0, limit).map((row) => ({
      rowIndex: row.rowIndex,
      warning: row.warningMessage ?? '',
    })),
  }
}
