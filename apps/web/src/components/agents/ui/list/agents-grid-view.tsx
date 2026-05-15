// apps/web/src/components/agents/ui/list/agents-grid-view.tsx
'use client'

import { useMemo } from 'react'
import { useAgentSearch } from '../../hooks/use-agent-search'
import { useAgents } from '../../hooks/use-agents'
import { filterAgents } from '../../utils/filter-agents'
import { AgentCard } from './agent-card'
import { AgentsEmptyState } from './agents-empty-state'

export function AgentsGridView() {
  const { agents, hasLoadedOnce } = useAgents()
  const { search } = useAgentSearch()

  // Drafts (`setupCompletedAt == null`) bubble to the top by `createdAt desc`
  // so resuming the last build is the obvious first action. Everything else
  // keeps the agents-list default order from the store.
  const filtered = useMemo(() => {
    const matched = filterAgents(agents, search)
    const drafts: typeof matched = []
    const rest: typeof matched = []
    for (const a of matched) {
      if (a.setupCompletedAt == null && a.archivedAt == null) drafts.push(a)
      else rest.push(a)
    }
    drafts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    return [...drafts, ...rest]
  }, [agents, search])

  if (!hasLoadedOnce) {
    return <div className='p-6 text-sm text-muted-foreground'>Loading agents…</div>
  }
  if (filtered.length === 0) {
    return <AgentsEmptyState isFirstRun={agents.length === 0} />
  }

  return (
    <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {filtered.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  )
}
