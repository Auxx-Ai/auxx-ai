// apps/web/src/components/evals/hooks/use-eval-cases-realtime.ts

'use client'

import { useCallback } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * Refresh the Simulations tab when an agent's eval cases change server-side
 * (today: the Kopilot `create_eval_case` / `update_eval_case_mock` tools, or
 * another tab's editor write). Listens for `eval:case-changed` on the org
 * channel and invalidates `eval.list` for the matching agent — a query refetch,
 * nothing more. There is no editor remount: the case list is query-driven, so
 * invalidation is idempotent and React Query dedupes concurrent fires (no risk
 * of re-running a suite — running is a separate explicit action).
 *
 * Mount once in the Simulations tab. The author's own tab refreshes too: the
 * Kopilot tool is a server-origin write that doesn't pass `excludeSocketId`,
 * while the editor's own tRPC writes do (and self-invalidate via `onSaved`).
 */
export function useEvalCasesRealtime(agentId: string) {
  const { hasAccess } = useFeatureFlags()
  const realtimeSyncEnabled = hasAccess('realtimeSync')
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (!realtimeSyncEnabled || event !== 'eval:case-changed') return
      const data = payload as { agentId?: string } | null
      if (data?.agentId !== agentId) return
      void utils.eval.list.invalidate({ agentId })
    },
    [realtimeSyncEnabled, agentId, utils]
  )

  useOrgChannel({ onEvent })
}
