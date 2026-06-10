// apps/web/src/components/evals/hooks/use-active-suite.ts
//
// The agent's currently-running suite (Phase 2.4), or null. Polls the cheap
// `listSuiteRuns` list while something is non-terminal so the Simulations tab
// trigger can show a pulse dot from the Build/Chat tabs. Keyed by `{agentId}`
// only — a second, agent-wide query alongside the panel's procedure-scoped one;
// both are cheap and React Query keeps them independent.

'use client'

import { api } from '~/trpc/react'
import { anySuiteRunning, selectActiveSuite } from '../utils/loop-logic'

export function useActiveSuite(agentId: string, enabled = true) {
  const suitesQuery = api.eval.listSuiteRuns.useQuery(
    { agentId },
    {
      enabled,
      refetchInterval: (q) => (anySuiteRunning(q.state.data?.suiteRuns) ? 4000 : false),
    }
  )
  return selectActiveSuite(suitesQuery.data?.suiteRuns)
}
