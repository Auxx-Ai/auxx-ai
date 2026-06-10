// apps/web/src/components/kopilot/ui/messages/eval-suite-progress.tsx
'use client'

import {
  suiteProgressRefetchInterval,
  TERMINAL_SUITE_STATUSES,
} from '~/components/evals/utils/loop-logic'
import { api } from '~/trpc/react'

/**
 * Live secondary for the `run_eval_suite` tool pill (evals 5D.3): suite
 * counters while the batch runs ("3/5 complete"), final counts once terminal.
 * Polls the same cheap query as the task watcher at the same cadence — React
 * Query dedupes, so this adds no extra traffic while a watch is active.
 */

export function EvalSuiteProgressSecondary({ suiteRunId }: { suiteRunId: string }) {
  const suite = api.eval.getSuiteRun.useQuery(
    { suiteRunId },
    { refetchInterval: (q) => suiteProgressRefetchInterval(q.state.data?.status) }
  ).data

  if (!suite) {
    return <span className='truncate text-muted-foreground'>results will arrive here</span>
  }
  if (!TERMINAL_SUITE_STATUSES.has(suite.status)) {
    return (
      <span className='truncate text-muted-foreground'>
        {suite.completedCount}/{suite.requestedCount} complete — results will arrive here
      </span>
    )
  }
  return (
    <span className='truncate text-muted-foreground'>
      {suite.passedCount} passed · {suite.failedCount} failed
      {suite.errorCount > 0 ? ` · ${suite.errorCount} errored` : ''}
    </span>
  )
}
