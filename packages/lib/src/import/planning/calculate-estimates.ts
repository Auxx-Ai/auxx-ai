// packages/lib/src/import/planning/calculate-estimates.ts

import type { PlanEstimates, RowAnalysis } from '../types/plan'

/**
 * Calculate plan estimates from row analyses.
 *
 * @param analyses - Array of row analysis results
 * @returns Plan estimates summary
 */
export function calculateEstimates(analyses: RowAnalysis[]): PlanEstimates {
  let toCreate = 0
  let toUpdate = 0
  let toSkip = 0
  let withErrors = 0

  for (const analysis of analyses) {
    switch (analysis.strategy) {
      case 'create':
        toCreate++
        break
      case 'update':
        toUpdate++
        break
      case 'skip':
        toSkip++
        break
    }

    if (analysis.errors.length > 0) {
      withErrors++
    }
  }

  return {
    totalRows: analyses.length,
    toCreate,
    toUpdate,
    toSkip,
    withErrors,
  }
}

/**
 * Calculate estimates from strategy counts.
 *
 * @param strategyCounts - Map of strategy → count
 * @param errorCount - Number of rows with errors
 * @returns Plan estimates summary
 */
export function calculateEstimatesFromCounts(
  strategyCounts: Record<string, number>,
  errorCount: number = 0
): PlanEstimates {
  return {
    totalRows:
      (strategyCounts['create'] || 0) +
      (strategyCounts['update'] || 0) +
      (strategyCounts['skip'] || 0),
    toCreate: strategyCounts['create'] || 0,
    toUpdate: strategyCounts['update'] || 0,
    toSkip: strategyCounts['skip'] || 0,
    withErrors: errorCount,
  }
}
