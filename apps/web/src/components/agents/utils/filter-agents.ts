// apps/web/src/components/agents/utils/filter-agents.ts

import type { AgentListItem } from '../store/agent-store'

/**
 * Filter the agent list by a free-text query against name + description.
 * Empty / whitespace-only queries pass everything through.
 */
export function filterAgents(agents: AgentListItem[], search: string): AgentListItem[] {
  const q = search.trim().toLowerCase()
  if (!q) return agents
  return agents.filter((a) => {
    const haystack = `${a.name ?? ''} ${a.description ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })
}
