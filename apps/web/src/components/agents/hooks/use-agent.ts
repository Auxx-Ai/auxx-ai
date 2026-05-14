// apps/web/src/components/agents/hooks/use-agent.ts
'use client'

import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import {
  type AgentDetail,
  type AgentListItem,
  selectEffectiveAgent,
  useAgentStore,
} from '../store/agent-store'

/**
 * Resolve one agent by id or slug. Returns the cached list-row immediately if
 * it's already in the store, plus the full detail row fetched via
 * `api.agent.getById` (whose input accepts either id or slug).
 */
export function useAgent(idOrSlug: string | null | undefined): {
  agent: AgentListItem | undefined
  detail: AgentDetail | undefined
  isLoading: boolean
} {
  const cached = useAgentStore(
    useShallow((s) => (idOrSlug ? selectEffectiveAgent(s, idOrSlug) : undefined))
  )

  const { data, isLoading } = api.agent.getById.useQuery(
    { agentId: idOrSlug ?? '' },
    { enabled: !!idOrSlug, staleTime: 30 * 1000 }
  )

  return {
    agent: cached,
    detail: data as AgentDetail | undefined,
    isLoading,
  }
}
