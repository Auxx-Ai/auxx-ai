// apps/web/src/components/agents/hooks/use-agents.ts
'use client'

import { useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import {
  type AgentListItem,
  getAgentStoreState,
  selectEffectiveAgents,
  useAgentStore,
} from '../store/agent-store'

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

  const agents = useAgentStore(useShallow(selectEffectiveAgents))
  const hasLoadedOnce = useAgentStore((s) => s.hasLoadedOnce)
  return { agents, isLoading, hasLoadedOnce }
}
