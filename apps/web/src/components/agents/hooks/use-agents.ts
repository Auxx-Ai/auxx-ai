// apps/web/src/components/agents/hooks/use-agents.ts
'use client'

import { useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import { type AgentListItem, getAgentStoreState, useAgentStore } from '../store/agent-store'

interface UseAgentsResult {
  agents: AgentListItem[]
  isLoading: boolean
  hasLoadedOnce: boolean
}

/**
 * Hydrates the agents store from `api.agent.list` and returns the effective
 * list (server rows merged with any pending optimistic updates).
 */
export function useAgents(): UseAgentsResult {
  const { data, isLoading } = api.agent.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    const store = getAgentStoreState()
    store.setLoading(isLoading)
    if (data) store.setAgents(data as AgentListItem[])
  }, [data, isLoading])

  const rawAgents = useAgentStore((s) => s.agents)
  const pendingUpdates = useAgentStore((s) => s.pendingUpdates)
  const hasLoadedOnce = useAgentStore((s) => s.hasLoadedOnce)

  const agents = useMemo(
    () =>
      rawAgents.map((a) => {
        const pending = pendingUpdates[a.id]
        return pending ? ({ ...a, ...pending.optimistic } as AgentListItem) : a
      }),
    [rawAgents, pendingUpdates]
  )

  return { agents, isLoading, hasLoadedOnce }
}
