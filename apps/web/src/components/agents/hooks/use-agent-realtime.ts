// apps/web/src/components/agents/hooks/use-agent-realtime.ts

'use client'

import { useEffect } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * Subscribe to `agent:updated` on the org channel and refresh the agent
 * detail/list React Query caches. No input filter on `getById.invalidate()`
 * — matches both id-keyed and slug-keyed cache entries in one call.
 *
 * Mount once at the agent detail page level. Org-wide for v1; if chatter
 * becomes a problem we narrow to an agent-scoped channel.
 */
export function useAgentRealtime() {
  const orgChannel = useOrgChannel()
  const { hasAccess } = useFeatureFlags()
  const realtimeSyncEnabled = hasAccess('realtimeSync')
  const utils = api.useUtils()

  useEffect(() => {
    if (!orgChannel || !realtimeSyncEnabled) return
    const onUpdate = () => {
      void utils.agent.getById.invalidate()
      void utils.agent.list.invalidate()
    }
    orgChannel.bind('agent:updated', onUpdate)
    return () => orgChannel.unbind('agent:updated', onUpdate)
  }, [orgChannel, realtimeSyncEnabled, utils])
}
