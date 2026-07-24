// apps/web/src/components/agents/ui/list/agents-empty-state.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Bot } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { useAccess } from '~/providers/capabilities-provider'
import { useAgentSearch } from '../../hooks/use-agent-search'
import { CreateAgentButton } from './create-agent-button'

interface AgentsEmptyStateProps {
  /** True when the unfiltered list itself is empty (no agents in org). */
  isFirstRun: boolean
}

export function AgentsEmptyState({ isFirstRun }: AgentsEmptyStateProps) {
  const { setSearch } = useAgentSearch()
  const { can } = useAccess()
  const canCreate = can(PermissionKey.agentsManage)
  if (isFirstRun) {
    return (
      <EmptyState
        icon={Bot}
        title='No agents yet'
        description={
          canCreate
            ? 'Create an agent to delegate work to AI.'
            : 'No agents have been set up yet. Ask an admin to create one.'
        }
        button={canCreate ? <CreateAgentButton /> : undefined}
      />
    )
  }
  return (
    <EmptyState
      icon={Bot}
      title='No agents match your search.'
      button={
        <Button variant='outline' size='sm' onClick={() => setSearch('')}>
          Clear
        </Button>
      }
    />
  )
}
