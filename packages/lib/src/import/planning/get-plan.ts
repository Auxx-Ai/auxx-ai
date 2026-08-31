// packages/lib/src/import/planning/get-plan.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, count, desc, eq, isNotNull, min } from 'drizzle-orm'
import type { ImportPlanStatus, PlanEstimates } from '../types/plan'
import { calculateEstimatesFromCounts } from './calculate-estimates'

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

  // The strategy -> bucket mapping lives in `calculateEstimatesFromCounts`,
  // the same one the planner uses. A local switch here was a third copy of it,
  // and adding the `unmatched` bucket had to be done in all three at once.
  //
  // `withErrors` IS the `skip` count on this path: a row lands in `skip`
  // BECAUSE it has an error, and a stored plan keeps no separate error tally.
  const strategyCounts: Record<string, number> = {}
  for (const strategy of plan.strategies) {
    strategyCounts[strategy.strategy] = getPlannedCount(strategy.statistics)
  }

  const estimates = calculateEstimatesFromCounts(strategyCounts, strategyCounts['skip'] ?? 0)

  // Two things the shared helper cannot know, kept as an explicit override:
  //
  // 1. `totalRows` is the FILE's row count, not the number of rows assigned so
  //    far. The helper sums its four buckets, which is right for a finished
  //    plan but would make the preview's total count upward while planning is
  //    still running.
  // 2. Nothing assigned yet (every bucket zero) shows the file as an all-create
  //    import rather than an empty one.
  const assignedRows = estimates.totalRows

  return {
    id: plan.id,
    jobId,
    status: plan.status as ImportPlanStatus,
    estimates: {
      ...estimates,
      totalRows: rowCount,
      toCreate: assignedRows === 0 ? rowCount : estimates.toCreate,
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

/** One distinct failure reason and how many rows hit it. */
export interface JobFailureReason {
  message: string
  count: number
  /** Lowest row index carrying this reason, for "first seen at row N". */
  firstRowIndex: number
}

/** Grouped execution failures for a finished job. */
export interface JobFailureSummary {
  /** Total failed rows across the job's plans. */
  total: number
  /** Distinct reasons, most frequent first. */
  reasons: JobFailureReason[]
}

/**
 * Group a finished job's failed rows by their error message.
 *
 * Keyed on the JOB rather than a plan: a job accumulates a plan per mapping
 * revision, and the caller showing the outcome knows the job, not which of its
 * plans was the one actually executed.
 *
 * Grouped because import failures are overwhelmingly systemic — one unmapped
 * required field fails every row with an identical message, and listing that
 * 201 times buries the single fact the user needs.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param limit - Max distinct reasons to return (default 10)
 */
export async function getJobFailureSummary(
  db: Database,
  jobId: string,
  limit: number = 10
): Promise<JobFailureSummary> {
  const rows = await db
    .select({
      message: schema.ImportPlanRow.errorMessage,
      count: count(),
      firstRowIndex: min(schema.ImportPlanRow.rowIndex),
    })
    .from(schema.ImportPlanRow)
    .innerJoin(
      schema.ImportPlanStrategy,
      eq(schema.ImportPlanRow.importPlanStrategyId, schema.ImportPlanStrategy.id)
    )
    .innerJoin(schema.ImportPlan, eq(schema.ImportPlanStrategy.importPlanId, schema.ImportPlan.id))
    .where(and(eq(schema.ImportPlan.importJobId, jobId), eq(schema.ImportPlanRow.status, 'failed')))
    .groupBy(schema.ImportPlanRow.errorMessage)
    .orderBy(desc(count()))

  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    reasons: rows.slice(0, limit).map((row) => ({
      message: row.message ?? 'Unknown error',
      count: row.count,
      firstRowIndex: row.firstRowIndex ?? 0,
    })),
  }
}
