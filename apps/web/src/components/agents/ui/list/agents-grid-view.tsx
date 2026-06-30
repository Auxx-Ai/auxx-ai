// apps/web/src/components/agents/ui/list/agents-grid-view.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { useEffect, useMemo } from 'react'
import { useListSelection } from '~/components/list-selection'
import { useAgentSearch } from '../../hooks/use-agent-search'
import { useAgents } from '../../hooks/use-agents'
import type { AgentListItem } from '../../store/agent-store'
import { filterAgents } from '../../utils/filter-agents'
import { AgentCard } from './agent-card'
import { AgentsEmptyState } from './agents-empty-state'

/**
 * Drafts (`setupCompletedAt == null`) bubble to the top by `createdAt desc` so
 * resuming the last build is the obvious first action. Everything else keeps
 * the agents-list default order from the store. Applied per section.
 */
function sortDraftFirst(list: AgentListItem[]): AgentListItem[] {
  const drafts: AgentListItem[] = []
  const rest: AgentListItem[] = []
  for (const a of list) {
    if (a.setupCompletedAt == null && a.archivedAt == null) drafts.push(a)
    else rest.push(a)
  }
  drafts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return [...drafts, ...rest]
}

function AgentGrid({ agents }: { agents: AgentListItem[] }) {
  return (
    <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  )
}

export function AgentsGridView() {
  const { agents, hasLoadedOnce } = useAgents()
  const { search } = useAgentSearch()
  const setItemIds = useListSelection((s) => s.setItemIds)

  const { chat, internal } = useMemo(() => {
    const matched = filterAgents(agents, search)
    return {
      chat: sortDraftFirst(matched.filter((a) => a.kind === 'chat')),
      internal: sortDraftFirst(matched.filter((a) => a.kind !== 'chat')),
    }
  }, [agents, search])

  // Keep the selection store's ordered ID list in sync (chat section, then
  // internal) so shift+click range and Cmd/Ctrl+A act on what's on screen.
  useEffect(() => {
    setItemIds([...chat, ...internal].map((a) => a.id))
  }, [chat, internal, setItemIds])

  if (!hasLoadedOnce) {
    return (
      <div className='flex flex-col gap-8'>
        <section className='flex flex-col gap-4'>
          <h2 className='text-sm font-semibold text-muted-foreground'>Chat agents</h2>
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {[...Array(4)].map((_, i) => (
              <ListCard key={`skeleton-${i}`} loading descriptionLines={1} />
            ))}
          </div>
        </section>
      </div>
    )
  }

  // Truly empty (no agents in org) or no search matches — the onboarding /
  // no-results empty state covers both. The sectioned layout only kicks in
  // once there's at least one matching agent to show.
  if (chat.length === 0 && internal.length === 0) {
    return <AgentsEmptyState isFirstRun={agents.length === 0} />
  }

  return (
    <div className='flex flex-col gap-8'>
      {/* Chat section is always shown so the chat-agent capability stays
          discoverable, even before any chat agent exists. */}
      <section className='flex flex-col gap-4'>
        <h2 className='text-sm font-semibold text-muted-foreground'>Chat agents</h2>
        {chat.length > 0 ? (
          <AgentGrid agents={chat} />
        ) : (
          <p className='text-sm text-muted-foreground'>
            No chat agents yet — create one to answer visitors in your chat widget.
          </p>
        )}
      </section>

      {internal.length > 0 ? (
        <section className='flex flex-col gap-4'>
          <h2 className='text-sm font-semibold text-muted-foreground'>Internal agents</h2>
          <AgentGrid agents={internal} />
        </section>
      ) : null}
    </div>
  )
}
