// packages/lib/src/import/planning/get-plan.ts

import { eq } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportPlanStatus, PlanEstimates } from '../types/plan'

/** Plan with estimates */
export interface PlanWithEstimates {
  id: string
  jobId: string
  status: ImportPlanStatus
  estimates: PlanEstimates
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
    const count = strategy.rowCount ?? 0
    switch (strategy.strategy) {
      case 'create':
        toCreate = count
        break
      case 'update':
        toUpdate = count
        break
      case 'skip':
        toSkip = count
        withErrors = strategy.errorCount ?? 0
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
  const errorRows = await db.query.ImportPlanRow.findMany({
    where: eq(schema.ImportPlanRow.status, 'failed'),
    limit,
  })

  return errorRows.map((row) => ({
    rowIndex: row.rowIndex,
    error: row.errorMessage ?? 'Unknown error',
  }))
}
