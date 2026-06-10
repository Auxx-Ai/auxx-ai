// apps/web/src/components/evals/hooks/use-suite-progress.ts
//
// Suite-level roll-up while a batch runs (phase 5D.3): polls the cheap
// counters query and stops on every terminal status. Child runs stream their
// own detail through the run-keyed SSE store; this is only the parent.

'use client'

import { api } from '~/trpc/react'
import { suiteProgressRefetchInterval, TERMINAL_SUITE_STATUSES } from '../utils/loop-logic'

/** Poll a suite run's counters while it is running. `null` disables the query. */
export function useSuiteProgress(suiteRunId: string | null) {
  const query = api.eval.getSuiteRun.useQuery(
    { suiteRunId: suiteRunId ?? '' },
    {
      enabled: suiteRunId != null,
      refetchInterval: (q) => suiteProgressRefetchInterval(q.state.data?.status),
    }
  )
  const suite = query.data ?? null
  return {
    suite,
    isRunning: suite != null && !TERMINAL_SUITE_STATUSES.has(suite.status),
  }
}
