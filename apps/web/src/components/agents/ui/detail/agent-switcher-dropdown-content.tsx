// apps/web/src/components/agents/ui/detail/agent-switcher-dropdown-content.tsx
'use client'

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import { Check, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAgents } from '../../hooks/use-agents'
import { AgentAvatar } from '../shared/agent-avatar'

interface AgentSwitcherDropdownContentProps {
  activeAgentId: string
}

/**
 * Body of the breadcrumb switcher dropdown — shows the active agent in the
 * header label, every other non-archived agent in the list, and a footer
 * "+ New agent" entry. Mirrors KBSwitcherDropdownContent at
 * `apps/web/src/components/kb/ui/sidebar/kb-switcher.tsx`.
 */
export function AgentSwitcherDropdownContent({ activeAgentId }: AgentSwitcherDropdownContentProps) {
  const router = useRouter()
  const { agents, isLoading } = useAgents()

  const active = agents.find((a) => a.id === activeAgentId)
  const others = agents.filter((a) => a.id !== activeAgentId && a.archivedAt == null)

  return (
    <>
      <DropdownMenuLabel className='p-0 font-normal'>
        <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
          {active ? <AgentAvatar agent={active} size={8} /> : null}
          <div className='grid flex-1 text-left text-sm leading-tight'>
            <span className='truncate font-semibold'>
              {isLoading ? 'Loading…' : active?.name || 'Agent'}
            </span>
            <span className='truncate text-xs text-muted-foreground'>
              {active?.archivedAt ? 'Archived' : 'Active'}
            </span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {isLoading ? (
        <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
      ) : others.length > 0 ? (
        others.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onSelect={() => router.push(`/app/agents/${agent.slug}`)}
            className='h-7 cursor-pointer'>
            <div className='flex items-center justify-between w-full'>
              <div className='flex items-center gap-2 min-w-0'>
                <AgentAvatar agent={agent} size={5} />
                <span className='truncate'>{agent.name || agent.slug}</span>
              </div>
              {agent.id === activeAgentId ? <Check className='size-3.5' /> : null}
            </div>
          </DropdownMenuItem>
        ))
      ) : (
        <DropdownMenuItem disabled>No other agents</DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => router.push('/app/agents/new')}>
        <Plus />
        New agent
      </DropdownMenuItem>
    </>
  )
}
