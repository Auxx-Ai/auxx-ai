// packages/lib/src/import/planning/calculate-estimates.ts

import type { PlanEstimates, RowAnalysis } from '../types/plan'

/**
 * Calculate plan estimates from row analyses.
 *
 * The four buckets PARTITION the rows: `toCreate + toUpdate + toSkip +
 * toUnmatched === totalRows`. `withErrors` is a cross-cut, not a fifth bucket.
 *
 * @param analyses - Array of row analysis results
 * @returns Plan estimates summary
 */
export function calculateEstimates(analyses: RowAnalysis[]): PlanEstimates {
  let toCreate = 0
  let toUpdate = 0
  let toSkip = 0
  let toUnmatched = 0
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
      case 'unmatched':
        toUnmatched++
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
    toUnmatched,
    withErrors,
  }
}

/**
 * Calculate estimates from strategy counts.
 *
 * `totalRows` sums all FOUR buckets. Leaving `unmatched` out of the sum would
 * make the preview report fewer rows than the file has, the same class of
 * silent row loss the planner's `continue` used to cause.
 *
 * @param strategyCounts - Map of strategy → count
 * @param errorCount - Number of rows with errors
 * @returns Plan estimates summary
 */
export function calculateEstimatesFromCounts(
  strategyCounts: Record<string, number>,
  errorCount: number = 0
): PlanEstimates {
  const toCreate = strategyCounts['create'] || 0
  const toUpdate = strategyCounts['update'] || 0
  const toSkip = strategyCounts['skip'] || 0
  const toUnmatched = strategyCounts['unmatched'] || 0

  return {
    totalRows: toCreate + toUpdate + toSkip + toUnmatched,
    toCreate,
    toUpdate,
    toSkip,
    toUnmatched,
    withErrors: errorCount,
  }
}
