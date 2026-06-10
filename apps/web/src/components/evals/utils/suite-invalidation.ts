// apps/web/src/components/evals/utils/suite-invalidation.ts
//
// When a suite reaches a terminal status, three read surfaces go stale: the
// suite list (history + active-suite polls), the case rows (status pills), and
// the run feed. Kept as a pure helper over a structurally-typed `utils` so the
// watcher bridge can fire it without a tRPC mount in tests (Phase 2.2).

/** The subset of `api.useUtils()` this helper invalidates. */
export interface SuiteInvalidationUtils {
  eval: {
    listSuiteRuns: { invalidate: () => Promise<void> }
    list: { invalidate: () => Promise<void> }
    listRuns: { invalidate: () => Promise<void> }
  }
}

/** Invalidate every read surface a finished suite changes. */
export function invalidateAfterSuiteTerminal(utils: SuiteInvalidationUtils): void {
  void utils.eval.listSuiteRuns.invalidate()
  void utils.eval.list.invalidate()
  void utils.eval.listRuns.invalidate()
}
