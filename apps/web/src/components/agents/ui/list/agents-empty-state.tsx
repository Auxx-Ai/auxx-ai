// apps/web/src/components/agents/ui/list/agents-empty-state.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Bot } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { useAgentSearch } from '../../hooks/use-agent-search'
import { CreateAgentButton } from './create-agent-button'

interface AgentsEmptyStateProps {
  /** True when the unfiltered list itself is empty (no agents in org). */
  isFirstRun: boolean
}

export function AgentsEmptyState({ isFirstRun }: AgentsEmptyStateProps) {
  const { setSearch } = useAgentSearch()
  if (isFirstRun) {
    return (
      <EmptyState
        icon={Bot}
        title='No agents yet'
        description='Create an agent to delegate work to AI.'
        button={<CreateAgentButton />}
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
