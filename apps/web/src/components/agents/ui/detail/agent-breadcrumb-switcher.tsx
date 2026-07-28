// apps/web/src/components/agents/ui/detail/agent-breadcrumb-switcher.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { EntityBreadcrumbSwitcher } from '~/components/pickers/entity-breadcrumb-switcher'
import type { EntitySwitcherItem } from '~/components/pickers/entity-switcher-list'
import { useAgents } from '../../hooks/use-agents'
import type { AgentDetail, AgentListItem } from '../../store/agent-store'
import { AgentAvatar } from '../shared/agent-avatar'

interface AgentBreadcrumbSwitcherProps {
  activeAgent: Pick<AgentDetail | AgentListItem, 'id' | 'name' | 'avatarUrl' | 'slug'>
}

/**
 * Breadcrumb switcher for the agent detail page — every non-archived agent,
 * the active one carrying the check, plus a "New agent" footer row.
 *
 * `id` stays the agent cuid (the permission key); the slug lives on `href`,
 * which is what agent routes actually navigate by.
 */
export function AgentBreadcrumbSwitcher({ activeAgent }: AgentBreadcrumbSwitcherProps) {
  const router = useRouter()
  const { agents, isLoading } = useAgents()

  const items = useMemo<EntitySwitcherItem[]>(
    () =>
      agents
        .filter((agent) => agent.archivedAt == null)
        .map((agent) => ({
          id: agent.id,
          label: agent.name ?? 'Untitled agent',
          href: `/app/agents/${agent.slug}`,
          icon: <AgentAvatar agent={agent} size={5} />,
        })),
    [agents]
  )

  return (
    <EntityBreadcrumbSwitcher
      activeLabel={activeAgent.name ?? 'Untitled agent'}
      activeIcon={<AgentAvatar agent={activeAgent} size={5} className='mr-1' />}
      items={items}
      activeId={activeAgent.id}
      isLoading={isLoading}
      onSelect={(item) => {
        if (item.href) router.push(item.href)
      }}
      onCreate={() => router.push('/app/agents/new')}
      createLabel='New agent'
      searchPlaceholder='Search agents...'
      emptyText='No agents'
    />
  )
}
