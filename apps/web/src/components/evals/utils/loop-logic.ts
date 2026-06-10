// apps/web/src/components/evals/utils/loop-logic.ts
//
// Pure decision logic for the improvement-loop UX (phase 5D), kept free of
// component/tRPC imports so it is unit-testable. Consumed by the suite panel,
// the active-suite hook, eval-suite-diff-card, and eval-case-row.

import type { EvalRunStatus } from '@auxx/types/evals'

/** Suite statuses where orchestration is over — polling stops, diffs unlock. */
export const TERMINAL_SUITE_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'cancelled',
  'error',
])

/**
 * Suite-progress poll gate: poll while the status is unknown (first load) or
 * non-terminal; stop on every terminal status.
 */
export function suiteProgressRefetchInterval(status: string | undefined): number | false {
  if (status !== undefined && TERMINAL_SUITE_STATUSES.has(status)) return false
  return 4000
}

/**
 * The first still-orchestrating suite in a list, or null (Phase 2). One suite
 * runs at a time, so "first non-terminal" is the active suite regardless of who
 * started it. Shared by the panel and the tab-indicator hook.
 */
export function selectActiveSuite<T extends { status: string }>(
  suites: readonly T[] | undefined
): T | null {
  return suites?.find((s) => !TERMINAL_SUITE_STATUSES.has(s.status)) ?? null
}

/**
 * List-level poll gate (Phase 2): true while any suite in the list is still
 * orchestrating. Generalizes `suiteProgressRefetchInterval` to a collection so
 * the Simulations tab polls `listSuiteRuns` only while something is running.
 */
export function anySuiteRunning(suites: readonly { status: string }[] | undefined): boolean {
  return selectActiveSuite(suites) != null
}

/**
 * Diff-card gating: a verdict diff renders only when the candidate has a
 * baseline pointer and both sides finished orchestrating as comparable suites
 * (`completed`/`cancelled` — an `error` suite never settled its children and
 * the lib rejects it with SUITE_NOT_TERMINAL). An unknown baseline (not yet
 * loaded) is allowed through — the query resolves it server-side.
 */
export function canShowSuiteDiff(
  candidate: { status: string } | null | undefined,
  baselineSuiteRunId: string | null | undefined,
  baseline?: { status: string } | null
): boolean {
  if (!candidate || !baselineSuiteRunId) return false
  const diffable = (s: string) => s === 'completed' || s === 'cancelled'
  if (!diffable(candidate.status)) return false
  return baseline == null ? true : diffable(baseline.status)
}

export interface CasePillRun {
  runId: string
  status: EvalRunStatus
  at: string
}

/**
 * Last-verified pill assignment (5D.4): a draft run never becomes the case's
 * primary signal. When the latest run is a draft, the primary stays on the
 * latest PINNED run (or "Not run") and the draft verdict renders as a badged
 * secondary.
 */
export function selectCasePills(
  latestRun: (CasePillRun & { runMode: string }) | null,
  latestPinnedRun: CasePillRun | null
): { primary: CasePillRun | null; draft: CasePillRun | null } {
  if (!latestRun) return { primary: null, draft: null }
  if (latestRun.runMode !== 'draft') return { primary: latestRun, draft: null }
  return { primary: latestPinnedRun, draft: latestRun }
}
