// apps/web/src/components/agents/hooks/use-agent-realtime.ts

'use client'

import { useCallback } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * Subscribe to `agent:updated` / `procedure:updated` on the org channel and
 * refresh the agent detail/list React Query caches. No input filter on
 * `getById.invalidate()` — matches both id-keyed and slug-keyed cache entries
 * in one call.
 *
 * Mount once at the agent detail page level. Org-wide for v1; if chatter
 * becomes a problem we narrow to an agent-scoped channel.
 *
 * The open procedure editor's draft doc is seed-once and needs a remount on
 * top of these invalidations — that lives in `useProcedureRealtime`, mounted
 * where the selected procedure id and reload key live.
 */
export function useAgentRealtime() {
  const { hasAccess } = useFeatureFlags()
  const realtimeSyncEnabled = hasAccess('realtimeSync')
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string) => {
      if (!realtimeSyncEnabled) return
      if (event === 'agent:updated') {
        void utils.agent.getById.invalidate()
        void utils.agent.list.invalidate()
      }
      if (event === 'procedure:updated') {
        void utils.procedure.getById.invalidate()
        void utils.procedure.list.invalidate()
        void utils.agentProcedure.list.invalidate()
      }
    },
    [realtimeSyncEnabled, utils]
  )

  useOrgChannel({ onEvent })
}
