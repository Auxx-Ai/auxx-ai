// packages/lib/src/import/execution/classify-outcome.ts

import type { ImportJobStatus } from '../types/job'

/** The row counters an outcome is derived from. */
export interface OutcomeCounters {
  created: number
  updated: number
  /** Rows skipped because they carry an ERROR. */
  skipped: number
  /** Rows update-only mode found no record for. Not an error. */
  unmatched?: number
  /** Update rows whose payload was empty. Nothing written, not a failure. */
  noOps?: number
  failed: number
}

/** How a finished run turned out, independent of the job-status keyspace. */
export type ImportOutcome = 'completed' | 'partial' | 'failed'

/**
 * Classify a finished run from its row counters.
 *
 * The single source of truth for "did this import work". Both
 * {@link executeImportPlan} and `markJobCompleted` derive from here rather than
 * each deciding for itself — which is exactly how a run with `failed: 201` and
 * nothing else reached the UI under a green check: the executor classified it
 * `'failed'`, and the job writer ignored that and hard-coded `'completed'`.
 *
 * A row that failed is never cancelled out by one that landed, so `partial` is
 * a distinct outcome and not a rounding of either neighbour.
 */
export function classifyImportOutcome(counters: OutcomeCounters): ImportOutcome {
  if (counters.failed === 0) return 'completed'

  const landed =
    counters.created +
    counters.updated +
    counters.skipped +
    (counters.unmatched ?? 0) +
    (counters.noOps ?? 0)

  return landed === 0 ? 'failed' : 'partial'
}

/**
 * Map an outcome onto the `ImportJob.status` keyspace.
 *
 * `partial` is its own terminal status rather than a flavour of `completed`,
 * so import history can never render a run that lost rows with the same badge
 * as one that did not.
 */
export function outcomeToJobStatus(outcome: ImportOutcome): ImportJobStatus {
  switch (outcome) {
    case 'completed':
      return 'completed'
    case 'partial':
      return 'completed_with_errors'
    case 'failed':
      return 'failed'
  }
}

/**
 * Whether a job status means execution finished and the run's results are finalized.
 *
 * Callers that gate on "is the wizard done" must use this rather than comparing
 * against `'completed'`, or a run that finished with failures reads as still
 * in flight.
 */
export function isFinishedImportStatus(status: ImportJobStatus | undefined): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'failed'
}
